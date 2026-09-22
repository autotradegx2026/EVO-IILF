BEGIN;
-- Ledger events and their alerts commit together. No external notification is sent here.
ALTER TABLE public.alerts
  ADD COLUMN environment text NOT NULL DEFAULT 'system' CHECK (environment IN ('paper','testnet','live','legacy','system')),
  ADD COLUMN currency text,
  ADD COLUMN source_id uuid,
  ADD COLUMN event_key text UNIQUE,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX alerts_user_environment_created ON public.alerts(user_id,environment,created_at DESC);
COMMENT ON COLUMN public.alerts.source_id IS 'paper_trades.id for paper; broker_executions.id for testnet/live; trades.id for linked legacy alerts.';
COMMENT ON COLUMN public.alerts.event_key IS 'Permanent lifecycle event identity; null for historical events that cannot be identified reliably.';

-- An old trade link proves legacy provenance, but does not prove a live fill or currency.
UPDATE public.alerts a SET environment='legacy',source_id=a.trade_id,
  metadata=jsonb_build_object('historical',true,'ledger','trades')
WHERE a.trade_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.trades t WHERE t.id=a.trade_id AND t.user_id=a.user_id);

-- Only associate the exact text and transaction timestamp emitted by migration 009.
-- Multiple possible matches stay unclassified. Never assign an ambiguous old alert to live.
WITH candidates AS (
 SELECT a.id,p.id AS source_id,p.currency,p.symbol,p.direction,
   CASE WHEN a.title='Paper trade opened' THEN 'OPEN' ELSE 'CLOSED' END AS event,
   count(*) OVER (PARTITION BY a.id) AS matches
 FROM public.alerts a JOIN public.paper_trades p ON p.user_id=a.user_id
 WHERE a.source_id IS NULL AND (
   (a.type='EXECUTION_SUCCESS' AND a.title='Paper trade opened' AND a.message=p.symbol AND a.created_at=p.opened_at)
   OR (a.title='Paper trade closed' AND p.status='CLOSED' AND a.created_at=p.last_checked_at
     AND a.type=CASE WHEN p.close_reason IN ('SL_HIT','TP_HIT','SESSION_END') THEN p.close_reason ELSE 'EXECUTION_SUCCESS' END
     AND a.message=p.symbol||' · '||p.close_reason||' · '||p.pnl||' '||p.currency)
 )
)
UPDATE public.alerts a SET environment='paper',currency=c.currency,source_id=c.source_id,
 event_key='paper:'||c.source_id||':historical:'||a.id,
 metadata=jsonb_build_object('historical',true,'ledger','paper_trades','event',c.event,'symbol',c.symbol,'direction',c.direction)
FROM candidates c WHERE c.id=a.id AND c.matches=1;

-- The previous worker emitted only ATTENTION alerts. Exact current snapshot text,
-- ownership, environment and a two-second save-to-alert window are required.
WITH candidates AS (
 SELECT a.id,b.id AS source_id,b.environment,b.currency,b.symbol,b.direction,b.error,
   count(*) OVER (PARTITION BY a.id) AS matches
 FROM public.alerts a JOIN public.broker_executions b ON b.user_id=a.user_id
 WHERE a.source_id IS NULL AND a.type='ORDER_REJECTED' AND b.state='ATTENTION'
   AND a.title=upper(b.environment)||' broker execution needs attention'
   AND a.message=b.symbol||': '||b.error||'. Inspect Broker Automation; unknown submissions are not retried.'
   AND a.created_at BETWEEN b.updated_at AND b.updated_at+interval '2 seconds'
)
UPDATE public.alerts a SET environment=c.environment,currency=c.currency,source_id=c.source_id,
 event_key='broker:'||c.source_id||':historical:'||a.id,
 metadata=jsonb_build_object('historical',true,'ledger','broker_executions','event','ATTENTION','symbol',c.symbol,'direction',c.direction,'error',c.error)
FROM candidates c WHERE c.id=a.id AND c.matches=1;

-- All emitted types are already accepted by alerts_type_check and AlertType.
-- This helper is private to the definer triggers; it exposes no client write surface.
CREATE FUNCTION public.append_ledger_alert(p_user uuid,p_environment text,p_currency text,p_source uuid,p_key text,p_event text,p_type text,p_title text,p_message text,p_metadata jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 INSERT INTO public.alerts(user_id,type,title,message,environment,currency,source_id,event_key,metadata)
 VALUES(p_user,p_type,p_title,p_message,p_environment,p_currency,p_source,p_key,
   coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('event',p_event))
 ON CONFLICT(event_key) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.append_ledger_alert(uuid,text,text,uuid,text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.alert_broker_execution_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prefix text:='broker:'||NEW.id||':'; label text:=upper(NEW.environment); detail jsonb; broker_name text;
BEGIN
 SELECT broker INTO broker_name FROM public.execution_accounts WHERE id=NEW.broker_account_id;
 -- Whitelist operational fields; never copy credentials, raw payloads, or order intents.
 detail:=jsonb_build_object('ledger','broker_executions','symbol',NEW.symbol,'direction',NEW.direction,
   'state',NEW.state,'version',NEW.version,'automatic',NEW.automatic,'broker',broker_name,
   'requested_quantity',NEW.requested_quantity,'entry_quantity',NEW.entry_quantity,'exit_quantity',NEW.exit_quantity,
   'entry_price',NEW.entry_price,'exit_price',NEW.exit_price,'stop_loss',NEW.stop_loss,'take_profit',NEW.take_profit,
   'gross_pnl',NEW.gross_pnl,'quote_fees',NEW.quote_fees,'other_fees',NEW.other_fees,
   'fee_basis',CASE WHEN broker_name='angelone' THEN 'gross_only' ELSE 'broker_reported' END,
   'residual_quantity',NEW.residual_quantity,'close_reason',NEW.close_reason,'error',NEW.error);
 IF TG_OP='INSERT' AND NEW.state='QUEUED' THEN
   PERFORM public.append_ledger_alert(NEW.user_id,NEW.environment,NEW.currency,NEW.id,prefix||'queued','QUEUED','EXECUTION_SUCCESS',
     label||' order queued',NEW.symbol||' · '||NEW.direction||' · Awaiting broker submission; no fill confirmed.',detail);
 END IF;
 IF NEW.entry_quantity>0 AND (TG_OP='INSERT' OR OLD.entry_quantity<=0) THEN
   PERFORM public.append_ledger_alert(NEW.user_id,NEW.environment,NEW.currency,NEW.id,prefix||'first-fill',
     CASE WHEN NEW.entry_quantity<NEW.requested_quantity THEN 'PARTIAL_FILL' ELSE 'FIRST_FILL' END,
     CASE WHEN NEW.direction='LONG' THEN 'LONG_ENTRY' ELSE 'SHORT_ENTRY' END,
     label||CASE WHEN NEW.entry_quantity<NEW.requested_quantity THEN ' entry partially filled' ELSE ' entry filled' END,
     NEW.symbol||' · '||NEW.entry_quantity||' filled at '||NEW.entry_price||' '||NEW.currency||' · Protection confirmation pending.',detail);
 END IF;
 IF NEW.state='OPEN' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
   PERFORM public.append_ledger_alert(NEW.user_id,NEW.environment,NEW.currency,NEW.id,prefix||'open','OPEN','EXECUTION_SUCCESS',
     label||' position protected',NEW.symbol||' · Broker protection confirmed for the open position.',detail);
 END IF;
 IF NEW.state='ATTENTION' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state OR OLD.error IS DISTINCT FROM NEW.error) THEN
   -- save_broker_execution increments version on every durable state change.
   PERFORM public.append_ledger_alert(NEW.user_id,NEW.environment,NEW.currency,NEW.id,prefix||'attention:'||NEW.version||':'||md5(coalesce(NEW.error,'')),
     'ATTENTION','ORDER_REJECTED',label||' execution needs attention',
     NEW.symbol||' · '||coalesce(NEW.error,'Reconciliation requires review')||' · Inspect Broker Automation; uncertain orders are not resubmitted.',detail);
 END IF;
 IF NEW.state='REJECTED' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
   PERFORM public.append_ledger_alert(NEW.user_id,NEW.environment,NEW.currency,NEW.id,prefix||'rejected','REJECTED','ORDER_REJECTED',
     label||' entry rejected',NEW.symbol||' · '||coalesce(NEW.error,'Entry rejected or canceled without a fill'),detail);
 END IF;
 IF NEW.state='CLOSED' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
   PERFORM public.append_ledger_alert(NEW.user_id,NEW.environment,NEW.currency,NEW.id,prefix||'closed','CLOSED',
     CASE WHEN NEW.close_reason IN ('SL_HIT','TP_HIT','SESSION_END') THEN NEW.close_reason ELSE 'EXECUTION_SUCCESS' END,
     label||' execution closed',NEW.symbol||' · '||coalesce(NEW.close_reason,'CLOSED')||' · Gross P&L '||NEW.gross_pnl||' '||NEW.currency
       ||' · Quote fees '||NEW.quote_fees||' '||NEW.currency||' · Residual inventory '||NEW.residual_quantity
       ||CASE WHEN broker_name='angelone' THEN ' · Broker fees unavailable.' ELSE ' · Other-asset fees are listed separately.' END,detail);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.alert_broker_execution_lifecycle() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER broker_execution_lifecycle_alert AFTER INSERT OR UPDATE ON public.broker_executions
 FOR EACH ROW EXECUTE FUNCTION public.alert_broker_execution_lifecycle();

CREATE FUNCTION public.alert_paper_trade_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE detail jsonb; prefix text:='paper:'||NEW.id||':';
BEGIN
 detail:=jsonb_build_object('ledger','paper_trades','symbol',NEW.symbol,'direction',NEW.direction,'source',NEW.source,
   'quantity',NEW.quantity,'entry_price',NEW.entry_price,'close_price',NEW.close_price,
   'stop_loss',NEW.stop_loss,'take_profit',NEW.take_profit,'pnl',NEW.pnl,'close_reason',NEW.close_reason,
   'simulated',true,'fee_basis','excluded');
 IF TG_OP='INSERT' THEN
   PERFORM public.append_ledger_alert(NEW.user_id,'paper',NEW.currency,NEW.id,prefix||'open','OPEN',
     CASE WHEN NEW.direction='LONG' THEN 'LONG_ENTRY' ELSE 'SHORT_ENTRY' END,'PAPER trade opened',
     NEW.symbol||' · '||NEW.direction||' · '||NEW.quantity||' at '||NEW.entry_price||' '||NEW.currency||' · Simulated fill; fees excluded.',detail);
 ELSIF NEW.status='CLOSED' AND OLD.status IS DISTINCT FROM NEW.status THEN
   PERFORM public.append_ledger_alert(NEW.user_id,'paper',NEW.currency,NEW.id,prefix||'closed','CLOSED',
     CASE WHEN NEW.close_reason IN ('SL_HIT','TP_HIT','SESSION_END') THEN NEW.close_reason ELSE 'EXECUTION_SUCCESS' END,'PAPER trade closed',
     NEW.symbol||' · '||coalesce(NEW.close_reason,'CLOSED')||' · Simulated P&L '||NEW.pnl||' '||NEW.currency||' · Fees excluded.',detail);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.alert_paper_trade_lifecycle() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER paper_trade_lifecycle_alert AFTER INSERT OR UPDATE ON public.paper_trades
 FOR EACH ROW EXECUTE FUNCTION public.alert_paper_trade_lifecycle();

-- Preserve the migration-009 risk, locking, ownership and cursor logic verbatim.
-- Only its two inline alert inserts move to the transactional ledger triggers.
CREATE OR REPLACE FUNCTION public.persist_webhook(p_user_id uuid,p_paper boolean,p_payload jsonb,p_hash text,p_state text,p_quantity numeric,p_risk numeric,p_ip text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result_id uuid;
BEGIN
 IF NOT p_paper THEN RETURN public.persist_webhook_v1(p_user_id,p_paper,p_payload,p_hash,p_state,p_quantity,p_risk,p_ip); END IF;
 IF p_payload->>'action' NOT IN ('LONG','SHORT') THEN RETURN NULL; END IF;
 INSERT INTO public.paper_trades(user_id,symbol,direction,entry_price,stop_loss,take_profit,quantity,risk_percent,confluence_score,payload_hash,signal_time,timeframe,source,notes)
 VALUES(p_user_id,p_payload->>'symbol',p_payload->>'action',(p_payload->>'price')::numeric,(p_payload->>'sl')::numeric,(p_payload->>'tp')::numeric,1,p_risk,(p_payload->>'confluence')::integer,p_hash,(p_payload->>'timestamp')::timestamptz,p_payload->>'tf',CASE WHEN p_ip='paper-scanner' THEN 'binance' ELSE 'tradingview' END,'Simulated signal-close fill; quote-currency units, no leverage or fees') RETURNING id INTO result_id;
 INSERT INTO public.webhook_logs(user_id,raw_payload,status,ip_address,processed_at) VALUES(p_user_id,p_payload||'{"is_paper":true}'::jsonb,'PROCESSED',p_ip,now());
 RETURN result_id;
END $$;

CREATE OR REPLACE FUNCTION public.apply_paper_mark(p_user_id uuid,p_trade_id uuid,p_expected_bar timestamptz,p_bar_time timestamptz,p_price numeric,p_close_price numeric DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.paper_trades; profit numeric;
BEGIN
 PERFORM 1 FROM public.settings WHERE user_id=p_user_id FOR UPDATE;
 SELECT * INTO t FROM public.paper_trades WHERE id=p_trade_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAPER_NOT_FOUND'; END IF;
 IF t.status<>'OPEN' THEN RETURN jsonb_build_object('status','ALREADY_CLOSED'); END IF;
 IF t.last_bar_at IS DISTINCT FROM p_expected_bar THEN RETURN jsonb_build_object('status','STALE_MARK'); END IF;
 IF p_price<=0 OR p_bar_time<t.signal_time OR (t.last_bar_at IS NOT NULL AND p_bar_time<=t.last_bar_at) OR p_bar_time>now()+interval '1 minute' THEN RETURN jsonb_build_object('status','INVALID_MARK'); END IF;
 IF p_reason IS NOT NULL THEN
   IF p_reason NOT IN ('SL_HIT','TP_HIT','SESSION_END','MANUAL') OR p_close_price IS NULL OR p_close_price<=0 THEN RAISE EXCEPTION 'INVALID_CLOSE'; END IF;
   profit:=round((CASE WHEN t.direction='LONG' THEN p_close_price-t.entry_price ELSE t.entry_price-p_close_price END)*t.quantity,2);
   UPDATE public.paper_trades SET status='CLOSED',close_price=p_close_price,close_reason=p_reason,pnl=profit,pnl_percent=profit/t.initial_capital*100,closed_at=p_bar_time,current_price=p_close_price,unrealized_pnl=0,last_bar_at=p_bar_time,last_checked_at=now(),monitor_error=NULL WHERE id=t.id;
   RETURN jsonb_build_object('status','CLOSED','reason',p_reason,'pnl',profit);
 END IF;
 UPDATE public.paper_trades SET current_price=p_price,unrealized_pnl=(CASE WHEN t.direction='LONG' THEN p_price-t.entry_price ELSE t.entry_price-p_price END)*t.quantity,last_bar_at=p_bar_time,last_checked_at=now(),monitor_error=NULL WHERE id=t.id;
 RETURN jsonb_build_object('status','MARKED');
END $$;

-- Existing table RLS and RPC grants remain unchanged.
COMMIT;
