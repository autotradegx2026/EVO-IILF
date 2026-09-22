BEGIN;
-- Retire the old synchronous entry path; manual and automatic submissions share the new ledger.
REVOKE EXECUTE ON FUNCTION public.reserve_trade(uuid,uuid,uuid,numeric,text) FROM service_role;
-- Credentials and controls are changed through authenticated server routes only.
CREATE TABLE public.execution_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 broker text NOT NULL CHECK(broker IN ('angelone','binance')), environment text NOT NULL CHECK(environment IN ('live','testnet')),
 label text NOT NULL, credentials_encrypted text NOT NULL, connected boolean NOT NULL DEFAULT false,
 last_checked_at timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(broker='binance' OR environment='live')
);
CREATE TABLE public.execution_settings (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 account_id uuid REFERENCES public.execution_accounts(id), auto_enabled boolean NOT NULL DEFAULT false,
 max_price_drift_bps integer NOT NULL DEFAULT 50 CHECK(max_price_drift_bps BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.execution_worker (
 name text PRIMARY KEY, lease_id uuid, lease_until timestamptz, heartbeat_at timestamptz,
 last_error text, enabled_environments text[] NOT NULL DEFAULT '{}'
);
INSERT INTO public.execution_worker(name) VALUES('broker');
CREATE TABLE public.broker_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
 broker_account_id uuid NOT NULL REFERENCES public.execution_accounts(id), signal_id uuid NOT NULL UNIQUE REFERENCES public.signals(id), automatic boolean NOT NULL DEFAULT false,
 environment text NOT NULL CHECK(environment IN ('live','testnet')), symbol text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('LONG','SHORT')), currency text NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','ENTERING','PROTECTING','OPEN','CLOSING','CLOSED','REJECTED','ATTENTION')),
 requested_quantity numeric NOT NULL CHECK(requested_quantity>0), signal_price numeric NOT NULL CHECK(signal_price>0), stop_loss numeric NOT NULL CHECK(stop_loss>0),
 take_profit numeric NOT NULL CHECK(take_profit>0), rr numeric NOT NULL CHECK(rr>0), risk_budget numeric NOT NULL CHECK(risk_budget>0),
 intents jsonb NOT NULL DEFAULT '[]', entry_quantity numeric NOT NULL DEFAULT 0, exit_quantity numeric NOT NULL DEFAULT 0,
 entry_price numeric NOT NULL DEFAULT 0, exit_price numeric NOT NULL DEFAULT 0, gross_pnl numeric NOT NULL DEFAULT 0,
 quote_fees numeric NOT NULL DEFAULT 0, other_fees jsonb NOT NULL DEFAULT '{}', residual_quantity numeric NOT NULL DEFAULT 0,
 close_reason text, error text, closing_requested boolean NOT NULL DEFAULT false,
 session_start text NOT NULL, session_end text NOT NULL, session_timezone text NOT NULL, deadline_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX one_active_broker_execution ON public.broker_executions(user_id) WHERE state NOT IN ('CLOSED','REJECTED');
CREATE INDEX broker_execution_poll ON public.broker_executions(state,updated_at);
CREATE TABLE public.execution_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, execution_id uuid REFERENCES public.broker_executions(id),
 user_id uuid NOT NULL REFERENCES public.users(id), state text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.execution_observations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id),
 account_id uuid NOT NULL REFERENCES public.execution_accounts(id), environment text NOT NULL,
 symbol text NOT NULL,timeframe text NOT NULL,bar_close timestamptz NOT NULL,observed_at timestamptz NOT NULL DEFAULT now(),
 config_hash text NOT NULL,config jsonb NOT NULL,qualified boolean NOT NULL,direction text,score integer NOT NULL,price numeric NOT NULL,reasons text[] NOT NULL,
 UNIQUE(user_id,account_id,symbol,timeframe,bar_close,config_hash)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['execution_accounts','execution_settings','execution_worker','broker_executions','execution_events','execution_observations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION public.claim_execution_worker(p_environments text[]) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE token uuid := gen_random_uuid(); BEGIN
 UPDATE execution_worker SET lease_id=token,lease_until=now()+interval '90 seconds',heartbeat_at=now(),enabled_environments=p_environments
 WHERE name='broker' AND (lease_until IS NULL OR lease_until<now());
 IF NOT FOUND THEN RETURN NULL; END IF; RETURN token;
END $$;
CREATE FUNCTION public.renew_execution_worker(p_lease uuid,p_release boolean DEFAULT false,p_error text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE execution_worker SET lease_until=CASE WHEN p_release THEN NULL ELSE now()+interval '90 seconds' END,
 heartbeat_at=now(),last_error=p_error WHERE name='broker' AND lease_id=p_lease AND lease_until>now();
 RETURN FOUND;
END $$;

CREATE FUNCTION public.queue_broker_execution(p_user uuid,p_signal uuid,p_account uuid,p_quantity numeric,p_balance numeric,p_stop numeric,p_target numeric,p_currency text,p_deadline timestamptz,p_auto boolean DEFAULT false)
RETURNS public.broker_executions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.settings; a public.execution_accounts; sig public.signals; cfg public.execution_settings;
 result public.broker_executions; day_start timestamptz; risk numeric; BEGIN
 SELECT * INTO s FROM settings WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR s.kill_switch_active THEN RAISE EXCEPTION 'EXECUTION_DISABLED'; END IF;
 PERFORM 1 FROM users WHERE id=p_user AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE'; END IF;
 SELECT * INTO cfg FROM execution_settings WHERE user_id=p_user;
 IF p_auto AND (NOT coalesce(cfg.auto_enabled,false) OR cfg.account_id IS DISTINCT FROM p_account) THEN RAISE EXCEPTION 'AUTOMATION_DISABLED'; END IF;
 SELECT * INTO a FROM execution_accounts WHERE id=p_account AND user_id=p_user AND connected;
 IF NOT FOUND THEN RAISE EXCEPTION 'BROKER_NOT_CONNECTED'; END IF;
 SELECT * INTO sig FROM signals WHERE id=p_signal AND user_id=p_user FOR UPDATE;
 IF NOT FOUND OR sig.is_executed OR sig.state NOT IN ('LONG_READY','SHORT_READY') THEN RAISE EXCEPTION 'SIGNAL_NOT_EXECUTABLE'; END IF;
 IF sig.received_at<now()-interval '5 minutes' OR sig.raw_payload->>'timestamp' IS NULL OR (sig.raw_payload->>'timestamp')::timestamptz<now()-interval '5 minutes' OR (sig.raw_payload->>'timestamp')::timestamptz>now()+interval '30 seconds' THEN RAISE EXCEPTION 'SIGNAL_EXPIRED'; END IF;
 IF s.signal_delivery_mode<>'signals' OR NOT(sig.symbol=ANY(s.screener_symbols)) OR sig.timeframe IS DISTINCT FROM s.screener_timeframe THEN RAISE EXCEPTION 'SIGNAL_CONFIGURATION_CHANGED'; END IF;
 IF sig.confluence_score<s.min_confluence_score OR coalesce(sig.rr_ratio,0)<s.rr_ratio-0.000001 THEN RAISE EXCEPTION 'SIGNAL_CONFLUENCE_OR_RR'; END IF;
 IF p_deadline IS NULL OR p_deadline<=now() OR p_deadline>now()+interval '25 hours' THEN RAISE EXCEPTION 'SESSION_CLOSED'; END IF;
 IF s.session_start<>s.session_end AND NOT (
   (s.session_start<s.session_end AND (now() AT TIME ZONE s.session_timezone)::time>=s.session_start AND (now() AT TIME ZONE s.session_timezone)::time<s.session_end) OR
   (s.session_start>s.session_end AND ((now() AT TIME ZONE s.session_timezone)::time>=s.session_start OR (now() AT TIME ZONE s.session_timezone)::time<s.session_end))
 ) THEN RAISE EXCEPTION 'SESSION_CLOSED'; END IF;
 IF a.broker='binance' AND (sig.direction<>'LONG' OR sig.symbol !~ '^BINANCE:[A-Z0-9]+USDT$' OR p_currency<>'USDT') THEN RAISE EXCEPTION 'BINANCE_SPOT_LONG_ONLY'; END IF;
 IF a.broker='angelone' AND (sig.symbol !~ '^(NSE|BSE):[A-Z0-9&-]+-EQ$' OR p_currency<>'INR') THEN RAISE EXCEPTION 'CASH_INSTRUMENT_REQUIRED'; END IF;
 risk:=p_balance*s.risk_percent/100;
 IF p_balance<=0 OR p_quantity<=0 OR p_quantity*sig.entry_price>p_balance*1.01 OR p_quantity*abs(sig.entry_price-p_stop)>risk*1.01 THEN RAISE EXCEPTION 'RISK_BUDGET_EXCEEDED'; END IF;
 IF NOT ((sig.direction='LONG' AND p_stop<sig.entry_price AND p_target>sig.entry_price) OR (sig.direction='SHORT' AND p_stop>sig.entry_price AND p_target<sig.entry_price)) THEN RAISE EXCEPTION 'INVALID_BRACKET'; END IF;
 IF EXISTS(SELECT 1 FROM trades WHERE user_id=p_user AND status IN ('OPEN','PENDING','PARTIAL')) THEN RAISE EXCEPTION 'LEGACY_EXPOSURE_REQUIRES_RECONCILIATION'; END IF;
 day_start := date_trunc('day',now() AT TIME ZONE s.session_timezone) AT TIME ZONE s.session_timezone;
 IF (SELECT count(*) FROM broker_executions WHERE user_id=p_user AND environment=a.environment AND created_at>=day_start AND state<>'REJECTED')>=s.max_trades_per_day THEN RAISE EXCEPTION 'MAX_TRADES_REACHED'; END IF;
 IF (SELECT coalesce(sum(greatest(0,-gross_pnl+quote_fees)),0) FROM broker_executions WHERE user_id=p_user AND environment=a.environment AND currency=p_currency AND updated_at>=day_start)>=p_balance*s.max_daily_loss_pct/100 THEN RAISE EXCEPTION 'DAILY_LOSS_LOCKED'; END IF;
 IF EXISTS(SELECT 1 FROM broker_executions WHERE user_id=p_user AND created_at>now()-s.cooldown_bars*(CASE s.screener_timeframe WHEN '1m' THEN interval '1 minute' WHEN '5m' THEN interval '5 minutes' WHEN '15m' THEN interval '15 minutes' ELSE interval '1 hour' END)) THEN RAISE EXCEPTION 'COOLDOWN_ACTIVE'; END IF;
 INSERT INTO broker_executions(user_id,broker_account_id,signal_id,automatic,environment,symbol,direction,currency,requested_quantity,signal_price,stop_loss,take_profit,rr,risk_budget,session_start,session_end,session_timezone,deadline_at)
 VALUES(p_user,p_account,p_signal,p_auto,a.environment,sig.symbol,sig.direction,p_currency,p_quantity,sig.entry_price,p_stop,p_target,s.rr_ratio,risk,s.session_start,s.session_end,s.session_timezone,p_deadline) RETURNING * INTO result;
 UPDATE signals SET is_executed=true WHERE id=p_signal;
 INSERT INTO execution_events(execution_id,user_id,state,detail) VALUES(result.id,p_user,'QUEUED',jsonb_build_object('automatic',p_auto,'environment',a.environment));
 RETURN result;
END $$;

CREATE FUNCTION public.save_broker_execution(p_lease uuid,p_id uuid,p_version integer,p_document jsonb) RETURNS public.broker_executions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result public.broker_executions; v public.broker_executions; BEGIN
 PERFORM 1 FROM execution_worker WHERE name='broker' AND lease_id=p_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WORKER_LEASE_LOST'; END IF;
 v:=jsonb_populate_record(NULL::public.broker_executions,p_document);
 UPDATE broker_executions SET state=v.state,intents=v.intents,entry_quantity=v.entry_quantity,exit_quantity=v.exit_quantity,
 entry_price=v.entry_price,exit_price=v.exit_price,gross_pnl=v.gross_pnl,quote_fees=v.quote_fees,other_fees=v.other_fees,
 residual_quantity=v.residual_quantity,close_reason=v.close_reason,error=v.error,
 closing_requested=closing_requested OR v.closing_requested,stop_loss=v.stop_loss,take_profit=v.take_profit,
 updated_at=now(),version=version+1 WHERE id=p_id AND version=p_version AND state NOT IN ('CLOSED','REJECTED') RETURNING * INTO result;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_VERSION_CHANGED'; END IF;
 INSERT INTO execution_events(execution_id,user_id,state,detail) VALUES(result.id,result.user_id,result.state,jsonb_build_object('version',result.version,'error',result.error,'entry',result.entry_quantity,'exit',result.exit_quantity,'gross_pnl',result.gross_pnl,'intents',result.intents));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.claim_execution_worker(text[]),public.renew_execution_worker(uuid,boolean,text),public.queue_broker_execution(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text,timestamptz,boolean),public.save_broker_execution(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_execution_worker(text[]),public.renew_execution_worker(uuid,boolean,text),public.queue_broker_execution(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text,timestamptz,boolean),public.save_broker_execution(uuid,uuid,integer,jsonb) TO service_role;
COMMIT;
