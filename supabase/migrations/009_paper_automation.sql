BEGIN;
ALTER TABLE public.settings
  ADD COLUMN paper_auto_scan boolean NOT NULL DEFAULT false,
  ADD COLUMN paper_last_scan_at timestamptz,
  ADD COLUMN paper_scan_error text;
ALTER TABLE public.paper_trades
  ADD COLUMN timeframe text NOT NULL DEFAULT '15m',
  ADD COLUMN signal_time timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_bar_at timestamptz,
  ADD COLUMN current_price numeric(18,6),
  ADD COLUMN unrealized_pnl numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN monitor_error text,
  ADD COLUMN last_checked_at timestamptz,
  ADD COLUMN currency text NOT NULL DEFAULT 'INR',
  ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','tradingview','binance')),
  ADD COLUMN session_start time NOT NULL DEFAULT '09:30',
  ADD COLUMN session_end time NOT NULL DEFAULT '15:30',
  ADD COLUMN session_timezone text NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE public.paper_trades DROP CONSTRAINT paper_trades_close_reason_check;
ALTER TABLE public.paper_trades ADD CONSTRAINT paper_trades_close_reason_check CHECK(close_reason IN ('SL_HIT','TP_HIT','MANUAL','SESSION_END'));
UPDATE public.paper_trades SET signal_time=opened_at;
DROP POLICY IF EXISTS paper_trades_own ON public.paper_trades;
CREATE POLICY paper_read_own ON public.paper_trades FOR SELECT TO authenticated USING (auth.uid()=user_id);
REVOKE INSERT,UPDATE,DELETE ON public.paper_trades FROM anon,authenticated;
GRANT SELECT ON public.paper_trades TO authenticated;
GRANT ALL ON public.paper_trades TO service_role;

-- Every entry and exit locks the same settings row. Limits cannot race a close.
CREATE FUNCTION public.guard_paper_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.settings; equity numeric; risk numeric; loss numeric; day_start timestamptz; clock time; bar_seconds integer; last_open timestamptz;
BEGIN
 SELECT * INTO s FROM public.settings WHERE user_id=NEW.user_id FOR UPDATE;
 IF NOT FOUND OR s.kill_switch_active OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.user_id AND is_active) THEN RAISE EXCEPTION 'PAPER_EXECUTION_DISABLED'; END IF;
 clock := (now() AT TIME ZONE s.session_timezone)::time;
 IF s.session_start<>s.session_end AND NOT (CASE WHEN s.session_start<s.session_end THEN clock>=s.session_start AND clock<s.session_end ELSE clock>=s.session_start OR clock<s.session_end END) THEN RAISE EXCEPTION 'SESSION_CLOSED'; END IF;
 NEW.currency := CASE WHEN NEW.symbol ~ '^(NSE|BSE):[A-Z0-9&.-]+-EQ$' THEN 'INR' WHEN NEW.symbol ~ '^BINANCE:[A-Z0-9]+USDT$' THEN 'USDT' WHEN NEW.symbol ~ '^OANDA:[A-Z]{6}$' THEN right(NEW.symbol,3) ELSE NULL END;
 IF NEW.currency IS NULL THEN RAISE EXCEPTION 'UNSUPPORTED_PAPER_INSTRUMENT'; END IF;
 NEW.session_start:=s.session_start; NEW.session_end:=s.session_end; NEW.session_timezone:=s.session_timezone;
 IF NEW.payload_hash IS NOT NULL THEN
   IF s.signal_delivery_mode<>'paper' OR NOT (NEW.symbol=ANY(s.screener_symbols)) THEN RAISE EXCEPTION 'PAPER_CONFIGURATION_CHANGED'; END IF;
   NEW.timeframe:=s.screener_timeframe;
   NEW.risk_percent:=s.risk_percent;
   NEW.source:=CASE WHEN NEW.symbol LIKE 'BINANCE:%' AND NEW.source='binance' THEN 'binance' ELSE 'tradingview' END;
 END IF;
 bar_seconds:=CASE NEW.timeframe WHEN '1m' THEN 60 WHEN '5m' THEN 300 WHEN '15m' THEN 900 WHEN '1h' THEN 3600 WHEN '60m' THEN 3600 ELSE 0 END;
 IF bar_seconds=0 OR NEW.signal_time<now()-interval '5 minutes' OR NEW.signal_time>now()+interval '1 minute' THEN RAISE EXCEPTION 'STALE_PAPER_SIGNAL'; END IF;
 IF NEW.entry_price<=0 OR NEW.stop_loss<=0 OR NEW.take_profit<=0 OR NOT (CASE WHEN NEW.direction='LONG' THEN NEW.stop_loss<NEW.entry_price AND NEW.entry_price<NEW.take_profit ELSE NEW.take_profit<NEW.entry_price AND NEW.entry_price<NEW.stop_loss END) THEN RAISE EXCEPTION 'INVALID_PRICE_LEVELS'; END IF;
 NEW.rr_ratio:=abs(NEW.take_profit-NEW.entry_price)/abs(NEW.entry_price-NEW.stop_loss);
 IF NEW.payload_hash IS NOT NULL AND (coalesce(NEW.confluence_score,0)<s.min_confluence_score OR NEW.rr_ratio+0.000001<s.rr_ratio) THEN RAISE EXCEPTION 'PAPER_STRATEGY_REJECTED'; END IF;
 day_start:=date_trunc('day',now() AT TIME ZONE s.session_timezone) AT TIME ZONE s.session_timezone;
 IF (SELECT count(*) FROM public.paper_trades WHERE user_id=NEW.user_id AND opened_at>=day_start)>=s.max_trades_per_day THEN RAISE EXCEPTION 'MAX_TRADES_REACHED'; END IF;
 IF EXISTS(SELECT 1 FROM public.paper_trades WHERE user_id=NEW.user_id AND status='OPEN') THEN RAISE EXCEPTION 'OPEN_POSITION_EXISTS'; END IF;
 SELECT max(opened_at) INTO last_open FROM public.paper_trades WHERE user_id=NEW.user_id;
 IF last_open IS NOT NULL AND now()<last_open+make_interval(secs=>s.cooldown_bars*bar_seconds) THEN RAISE EXCEPTION 'COOLDOWN_ACTIVE'; END IF;
 SELECT 100000+coalesce(sum(pnl),0) INTO equity FROM public.paper_trades WHERE user_id=NEW.user_id AND currency=NEW.currency AND status='CLOSED';
 SELECT coalesce(-sum(least(pnl,0)),0) INTO loss FROM public.paper_trades WHERE user_id=NEW.user_id AND currency=NEW.currency AND status='CLOSED' AND closed_at>=day_start;
 IF equity<=0 OR loss>=equity*s.max_daily_loss_pct/100 THEN RAISE EXCEPTION 'DAILY_LOSS_LOCKED'; END IF;
 NEW.initial_capital:=equity; risk:=equity*NEW.risk_percent/100;
 IF NEW.payload_hash IS NOT NULL THEN
   NEW.quantity:=floor(least(risk/abs(NEW.entry_price-NEW.stop_loss),equity/NEW.entry_price)*(CASE WHEN NEW.currency='INR' THEN 1 ELSE 10000 END))/(CASE WHEN NEW.currency='INR' THEN 1 ELSE 10000 END);
 END IF;
 IF NEW.quantity<=0 OR NEW.quantity*abs(NEW.entry_price-NEW.stop_loss)>risk+0.01 OR NEW.quantity*NEW.entry_price>equity+0.01 THEN RAISE EXCEPTION 'INSUFFICIENT_RISK_BUDGET'; END IF;
 NEW.current_price:=NEW.entry_price; NEW.status:='OPEN'; NEW.opened_at:=now(); NEW.pnl:=0; NEW.closed_at:=NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_paper_entry BEFORE INSERT ON public.paper_trades FOR EACH ROW EXECUTE FUNCTION public.guard_paper_entry();
REVOKE ALL ON FUNCTION public.guard_paper_entry() FROM PUBLIC,anon,authenticated;

-- Preserve the existing live-signal path; enrich paper metadata in its transaction.
ALTER FUNCTION public.persist_webhook(uuid,boolean,jsonb,text,text,numeric,numeric,text) RENAME TO persist_webhook_v1;
CREATE FUNCTION public.persist_webhook(p_user_id uuid,p_paper boolean,p_payload jsonb,p_hash text,p_state text,p_quantity numeric,p_risk numeric,p_ip text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result_id uuid;
BEGIN
 IF NOT p_paper THEN RETURN public.persist_webhook_v1(p_user_id,p_paper,p_payload,p_hash,p_state,p_quantity,p_risk,p_ip); END IF;
 IF p_payload->>'action' NOT IN ('LONG','SHORT') THEN RETURN NULL; END IF;
 INSERT INTO public.paper_trades(user_id,symbol,direction,entry_price,stop_loss,take_profit,quantity,risk_percent,confluence_score,payload_hash,signal_time,timeframe,source,notes)
 VALUES(p_user_id,p_payload->>'symbol',p_payload->>'action',(p_payload->>'price')::numeric,(p_payload->>'sl')::numeric,(p_payload->>'tp')::numeric,1,p_risk,(p_payload->>'confluence')::integer,p_hash,(p_payload->>'timestamp')::timestamptz,p_payload->>'tf',CASE WHEN p_ip='paper-scanner' THEN 'binance' ELSE 'tradingview' END,'Simulated signal-close fill; quote-currency units, no leverage or fees') RETURNING id INTO result_id;
 INSERT INTO public.webhook_logs(user_id,raw_payload,status,ip_address,processed_at) VALUES(p_user_id,p_payload||'{"is_paper":true}'::jsonb,'PROCESSED',p_ip,now());
 INSERT INTO public.alerts(user_id,type,title,message) VALUES(p_user_id,'EXECUTION_SUCCESS','Paper trade opened',p_payload->>'symbol');
 RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION public.persist_webhook_v1(uuid,boolean,jsonb,text,text,numeric,numeric,text) FROM service_role;
REVOKE ALL ON FUNCTION public.persist_webhook(uuid,boolean,jsonb,text,text,numeric,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_webhook(uuid,boolean,jsonb,text,text,numeric,numeric,text) TO service_role;

CREATE FUNCTION public.apply_paper_mark(p_user_id uuid,p_trade_id uuid,p_expected_bar timestamptz,p_bar_time timestamptz,p_price numeric,p_close_price numeric DEFAULT NULL,p_reason text DEFAULT NULL)
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
   INSERT INTO public.alerts(user_id,type,title,message) VALUES(p_user_id,CASE WHEN p_reason IN ('SL_HIT','TP_HIT','SESSION_END') THEN p_reason ELSE 'EXECUTION_SUCCESS' END,'Paper trade closed',t.symbol||' · '||p_reason||' · '||profit||' '||t.currency);
   RETURN jsonb_build_object('status','CLOSED','reason',p_reason,'pnl',profit);
 END IF;
 UPDATE public.paper_trades SET current_price=p_price,unrealized_pnl=(CASE WHEN t.direction='LONG' THEN p_price-t.entry_price ELSE t.entry_price-p_price END)*t.quantity,last_bar_at=p_bar_time,last_checked_at=now(),monitor_error=NULL WHERE id=t.id;
 RETURN jsonb_build_object('status','MARKED');
END $$;
REVOKE ALL ON FUNCTION public.apply_paper_mark(uuid,uuid,timestamptz,timestamptz,numeric,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paper_mark(uuid,uuid,timestamptz,timestamptz,numeric,numeric,text) TO service_role;

CREATE TABLE public.automation_runs (name text PRIMARY KEY,last_started_at timestamptz,last_finished_at timestamptz,result jsonb,lease_id uuid,lease_until timestamptz);
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.automation_runs TO service_role;
CREATE FUNCTION public.claim_paper_job() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE token uuid:=gen_random_uuid(); claimed uuid;
BEGIN
 INSERT INTO public.automation_runs(name,lease_id,lease_until,last_started_at) VALUES('paper',token,now()+interval '2 minutes',now())
 ON CONFLICT(name) DO UPDATE SET lease_id=token,lease_until=now()+interval '2 minutes',last_started_at=now() WHERE automation_runs.lease_until IS NULL OR automation_runs.lease_until<now()
 RETURNING lease_id INTO claimed;
 RETURN claimed;
END $$;
REVOKE ALL ON FUNCTION public.claim_paper_job() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paper_job() TO service_role;
COMMIT;
