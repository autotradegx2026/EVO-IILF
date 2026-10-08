-- MetaTrader 5 (XM, Vantage and other MT5 brokers) through the AutotradeX Bridge Expert Advisor.
-- The EA runs inside a broker-logged-in MT5 terminal, polls /api/mt5/bridge with a per-account token,
-- executes queued commands and reports account, symbol, command and position/deal state.
-- MT5 demo accounts use the 'testnet' environment; real accounts use 'live'.
BEGIN;

ALTER TABLE public.execution_accounts DROP CONSTRAINT execution_accounts_broker_check;
ALTER TABLE public.execution_accounts ADD CONSTRAINT execution_accounts_broker_check CHECK (broker IN ('angelone','binance','mt5'));
ALTER TABLE public.execution_accounts DROP CONSTRAINT execution_accounts_check;
ALTER TABLE public.execution_accounts ADD CONSTRAINT execution_accounts_check CHECK (broker IN ('binance','mt5') OR environment='live');

CREATE TABLE public.mt5_bridges (
 account_id uuid PRIMARY KEY REFERENCES public.execution_accounts(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 login bigint, server text, company text, trade_mode text CHECK (trade_mode IN ('DEMO','CONTEST','REAL')),
 margin_mode text, currency text, balance numeric, equity numeric, margin_free numeric, leverage integer,
 trade_allowed boolean NOT NULL DEFAULT false, connected boolean NOT NULL DEFAULT false, build integer,
 untracked_positions integer NOT NULL DEFAULT 0, heartbeat_at timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.mt5_symbols (
 account_id uuid NOT NULL REFERENCES public.execution_accounts(id) ON DELETE CASCADE,
 request text NOT NULL, resolved text, base text, quote text, digits integer,
 tick_size numeric, tick_value numeric, contract_size numeric,
 volume_min numeric, volume_max numeric, volume_step numeric,
 bid numeric, ask numeric, margin_per_lot numeric, trade_mode integer, quote_time timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_id, request)
);

CREATE TABLE public.mt5_commands (
 id bigserial PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.execution_accounts(id) ON DELETE CASCADE,
 client_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('ENTRY','PROTECT','UNPROTECT','CLOSE')),
 entry_client_id text NOT NULL, request text NOT NULL, side text CHECK (side IN ('BUY','SELL')),
 volume numeric, sl numeric, tp numeric,
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','DONE','FAILED')),
 retcode integer, message text, order_ticket bigint, deal_ticket bigint, position_id bigint, price numeric, volume_done numeric,
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, done_at timestamptz,
 UNIQUE (account_id, client_id)
);
CREATE INDEX mt5_commands_open ON public.mt5_commands(account_id, status) WHERE status IN ('PENDING','SENT');

CREATE TABLE public.mt5_positions (
 account_id uuid NOT NULL REFERENCES public.execution_accounts(id) ON DELETE CASCADE,
 position_id bigint NOT NULL, symbol text, open boolean NOT NULL, sl numeric, tp numeric,
 deals jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (account_id, position_id)
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['mt5_bridges','mt5_symbols','mt5_commands','mt5_positions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
 END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.mt5_commands_id_seq TO service_role;

-- Hand pending commands to the bridge exactly once. Entries never execute late: an entry the bridge
-- did not collect within 15 seconds fails as EXPIRED. Protection and exits never expire.
CREATE FUNCTION public.mt5_claim_commands(p_account uuid) RETURNS SETOF public.mt5_commands
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE mt5_commands SET status='FAILED', message='EXPIRED_BEFORE_DELIVERY', done_at=now()
  WHERE account_id=p_account AND status='PENDING' AND kind='ENTRY' AND created_at<now()-interval '15 seconds';
 RETURN QUERY UPDATE mt5_commands c SET status='SENT', sent_at=now()
  WHERE c.id IN (SELECT id FROM mt5_commands WHERE account_id=p_account AND status='PENDING' ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
  RETURNING c.*;
END $$;
REVOKE ALL ON FUNCTION public.mt5_claim_commands(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mt5_claim_commands(uuid) TO service_role;

-- Margin brokers size against margin capacity (p_balance, in quote currency) but take risk and the
-- daily-loss lock from equity (p_capital). Spot brokers omit p_capital and keep the previous rules.
DROP FUNCTION public.queue_broker_execution(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text,timestamptz,boolean);
CREATE FUNCTION public.queue_broker_execution(p_user uuid,p_signal uuid,p_account uuid,p_quantity numeric,p_balance numeric,p_stop numeric,p_target numeric,p_currency text,p_deadline timestamptz,p_auto boolean DEFAULT false,p_capital numeric DEFAULT NULL)
RETURNS public.broker_executions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.settings; a public.execution_accounts; sig public.signals; cfg public.execution_settings;
 result public.broker_executions; day_start timestamptz; risk numeric; capital numeric; BEGIN
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
 IF a.broker='mt5' AND (sig.symbol !~ '^[A-Z0-9_]+:[A-Z0-9._]+$' OR sig.symbol ~ '^(NSE|BSE|BINANCE):' OR p_capital IS NULL) THEN RAISE EXCEPTION 'MT5_INSTRUMENT_REQUIRED'; END IF;
 IF a.broker<>'mt5' AND p_capital IS NOT NULL THEN RAISE EXCEPTION 'CAPITAL_ONLY_FOR_MARGIN_BROKERS'; END IF;
 capital:=coalesce(p_capital,p_balance);
 risk:=capital*s.risk_percent/100;
 IF p_balance<=0 OR capital<=0 OR p_quantity<=0 OR p_quantity*sig.entry_price>p_balance*1.01 OR p_quantity*abs(sig.entry_price-p_stop)>risk*1.01 THEN RAISE EXCEPTION 'RISK_BUDGET_EXCEEDED'; END IF;
 IF NOT ((sig.direction='LONG' AND p_stop<sig.entry_price AND p_target>sig.entry_price) OR (sig.direction='SHORT' AND p_stop>sig.entry_price AND p_target<sig.entry_price)) THEN RAISE EXCEPTION 'INVALID_BRACKET'; END IF;
 IF EXISTS(SELECT 1 FROM trades WHERE user_id=p_user AND status IN ('OPEN','PENDING','PARTIAL')) THEN RAISE EXCEPTION 'LEGACY_EXPOSURE_REQUIRES_RECONCILIATION'; END IF;
 day_start := date_trunc('day',now() AT TIME ZONE s.session_timezone) AT TIME ZONE s.session_timezone;
 IF (SELECT count(*) FROM broker_executions WHERE user_id=p_user AND environment=a.environment AND created_at>=day_start AND state<>'REJECTED')>=s.max_trades_per_day THEN RAISE EXCEPTION 'MAX_TRADES_REACHED'; END IF;
 IF (SELECT coalesce(sum(greatest(0,-gross_pnl+quote_fees)),0) FROM broker_executions WHERE user_id=p_user AND environment=a.environment AND currency=p_currency AND updated_at>=day_start)>=capital*s.max_daily_loss_pct/100 THEN RAISE EXCEPTION 'DAILY_LOSS_LOCKED'; END IF;
 IF EXISTS(SELECT 1 FROM broker_executions WHERE user_id=p_user AND created_at>now()-s.cooldown_bars*(CASE s.screener_timeframe WHEN '1m' THEN interval '1 minute' WHEN '5m' THEN interval '5 minutes' WHEN '15m' THEN interval '15 minutes' ELSE interval '1 hour' END)) THEN RAISE EXCEPTION 'COOLDOWN_ACTIVE'; END IF;
 INSERT INTO broker_executions(user_id,broker_account_id,signal_id,automatic,environment,symbol,direction,currency,requested_quantity,signal_price,stop_loss,take_profit,rr,risk_budget,session_start,session_end,session_timezone,deadline_at)
 VALUES(p_user,p_account,p_signal,p_auto,a.environment,sig.symbol,sig.direction,p_currency,p_quantity,sig.entry_price,p_stop,p_target,s.rr_ratio,risk,s.session_start,s.session_end,s.session_timezone,p_deadline) RETURNING * INTO result;
 UPDATE signals SET is_executed=true WHERE id=p_signal;
 INSERT INTO execution_events(execution_id,user_id,state,detail) VALUES(result.id,p_user,'QUEUED',jsonb_build_object('automatic',p_auto,'environment',a.environment));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.queue_broker_execution(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text,timestamptz,boolean,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_broker_execution(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text,timestamptz,boolean,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.start_broker_run(p_user uuid, p_account uuid, p_symbol text, p_timeframe text, p_drift integer, p_expected_credentials text)
RETURNS public.execution_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.execution_accounts; s public.settings;
BEGIN
 SELECT * INTO s FROM settings WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_CONFIGURATION_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM execution_accounts WHERE id=p_account AND user_id=p_user FOR UPDATE;
 IF NOT FOUND OR NOT a.connected THEN RAISE EXCEPTION 'BROKER_NOT_CONNECTED'; END IF;
 IF p_timeframe NOT IN ('1m','5m','15m','1h') OR p_symbol IS NULL OR NOT (CASE a.broker
     WHEN 'binance' THEN p_symbol ~ '^BINANCE:[A-Z0-9]+USDT$'
     WHEN 'mt5' THEN p_symbol ~ '^[A-Z0-9_]+:[A-Z0-9._]+$' AND p_symbol !~ '^(NSE|BSE|BINANCE):'
     ELSE p_symbol ~ '^(NSE|BSE):[A-Z0-9&.-]+-EQ$' END) THEN RAISE EXCEPTION 'Select a supported symbol and timeframe for this broker.'; END IF;
 IF EXISTS(SELECT 1 FROM broker_executions WHERE user_id=p_user AND state NOT IN ('CLOSED','REJECTED')) THEN RAISE EXCEPTION 'Resolve existing broker positions before starting a new run.'; END IF;
 UPDATE settings SET screener_symbols=ARRAY[p_symbol],screener_timeframe=p_timeframe,signal_delivery_mode='signals' WHERE user_id=p_user;
 RETURN configure_execution_settings(p_user,p_account,true,p_drift,p_expected_credentials);
END $$;

COMMIT;
