BEGIN;
ALTER TABLE paper_observations ADD COLUMN analysis jsonb;
CREATE FUNCTION public.lock_running_strategy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE shared_changed boolean; broker_changed boolean; broker_running boolean;
BEGIN
 shared_changed := (to_jsonb(NEW)-ARRAY['updated_at','execution_config_updated_at','paper_last_scan_at','paper_scan_error','paper_trading_enabled','paper_started_at','paper_stopped_at','paper_auto_scan','paper_symbols','paper_timeframe','webhook_secret','delivery_token_hash','kill_switch_active','screener_symbols','screener_timeframe','signal_delivery_mode']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','execution_config_updated_at','paper_last_scan_at','paper_scan_error','paper_trading_enabled','paper_started_at','paper_stopped_at','paper_auto_scan','paper_symbols','paper_timeframe','webhook_secret','delivery_token_hash','kill_switch_active','screener_symbols','screener_timeframe','signal_delivery_mode']);
 broker_changed := ROW(NEW.screener_symbols,NEW.screener_timeframe,NEW.signal_delivery_mode) IS DISTINCT FROM ROW(OLD.screener_symbols,OLD.screener_timeframe,OLD.signal_delivery_mode);
 SELECT coalesce(auto_enabled,false) INTO broker_running FROM execution_settings WHERE user_id=OLD.user_id;
 IF coalesce(broker_running,false) AND (shared_changed OR broker_changed) THEN RAISE EXCEPTION 'Stop broker trading before changing its strategy, symbol or timeframe.'; END IF;
 IF OLD.paper_trading_enabled AND (shared_changed OR (NOT OLD.paper_auto_scan AND broker_changed) OR ROW(NEW.paper_auto_scan,NEW.paper_symbols,NEW.paper_timeframe) IS DISTINCT FROM ROW(OLD.paper_auto_scan,OLD.paper_symbols,OLD.paper_timeframe)) THEN RAISE EXCEPTION 'Stop paper trading before changing its strategy, source, symbols or timeframe.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lock_running_strategy BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION lock_running_strategy();
REVOKE ALL ON FUNCTION lock_running_strategy() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.lock_running_broker() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.auto_enabled AND ROW(NEW.account_id,NEW.max_price_drift_bps) IS DISTINCT FROM ROW(OLD.account_id,OLD.max_price_drift_bps) THEN RAISE EXCEPTION 'Stop broker trading before changing the selected account or entry limits.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lock_running_broker BEFORE UPDATE ON execution_settings FOR EACH ROW EXECUTE FUNCTION lock_running_broker();
REVOKE ALL ON FUNCTION lock_running_broker() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.start_broker_run(p_user uuid,p_account uuid,p_symbol text,p_timeframe text,p_drift integer,p_expected_credentials text)
RETURNS public.execution_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.execution_accounts; s public.settings;
BEGIN
 SELECT * INTO s FROM settings WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_CONFIGURATION_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM execution_accounts WHERE id=p_account AND user_id=p_user FOR UPDATE;
 IF NOT FOUND OR NOT a.connected THEN RAISE EXCEPTION 'BROKER_NOT_CONNECTED'; END IF;
 IF p_timeframe NOT IN ('1m','5m','15m','1h') OR p_symbol IS NULL OR NOT (CASE WHEN a.broker='binance' THEN p_symbol ~ '^BINANCE:[A-Z0-9]+USDT$' ELSE p_symbol ~ '^(NSE|BSE):[A-Z0-9&.-]+-EQ$' END) THEN RAISE EXCEPTION 'Select a supported symbol and timeframe for this broker.'; END IF;
 IF EXISTS(SELECT 1 FROM broker_executions WHERE user_id=p_user AND state NOT IN ('CLOSED','REJECTED')) THEN RAISE EXCEPTION 'Resolve existing broker positions before starting a new run.'; END IF;
 UPDATE settings SET screener_symbols=ARRAY[p_symbol],screener_timeframe=p_timeframe,signal_delivery_mode='signals' WHERE user_id=p_user;
 RETURN configure_execution_settings(p_user,p_account,true,p_drift,p_expected_credentials);
END $$;
REVOKE ALL ON FUNCTION start_broker_run(uuid,uuid,text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION start_broker_run(uuid,uuid,text,text,integer,text) TO service_role;
CREATE TABLE public.paper_analysis_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 symbol text NOT NULL,timeframe text NOT NULL,bar_close timestamptz NOT NULL,config_revision text NOT NULL,
 checked_at timestamptz NOT NULL,price numeric,score integer,status text NOT NULL,reasons text[] NOT NULL,analysis jsonb NOT NULL,
 UNIQUE(user_id,symbol,timeframe,bar_close,config_revision)
);
CREATE INDEX paper_analysis_history_recent ON paper_analysis_history(user_id,bar_close DESC);
ALTER TABLE paper_analysis_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY paper_analysis_history_read ON paper_analysis_history FOR SELECT TO authenticated USING(auth.uid()=user_id AND lower((select auth.jwt())->>'email')='autotradegx2026@gmail.com');
REVOKE ALL ON paper_analysis_history FROM anon,authenticated;
GRANT SELECT ON paper_analysis_history TO authenticated;
GRANT ALL ON paper_analysis_history TO service_role;
CREATE FUNCTION record_paper_analysis() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.bar_close IS NOT NULL AND NEW.analysis IS NOT NULL AND NEW.analysis->>'configRevision' IS NOT NULL THEN
  INSERT INTO paper_analysis_history(user_id,symbol,timeframe,bar_close,config_revision,checked_at,price,score,status,reasons,analysis)
  VALUES(NEW.user_id,NEW.symbol,NEW.timeframe,NEW.bar_close,NEW.analysis->>'configRevision',NEW.checked_at,NEW.price,NEW.score,NEW.status,NEW.reasons,NEW.analysis)
  ON CONFLICT(user_id,symbol,timeframe,bar_close,config_revision) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER record_paper_analysis AFTER INSERT OR UPDATE ON paper_observations FOR EACH ROW EXECUTE FUNCTION record_paper_analysis();
REVOKE ALL ON FUNCTION record_paper_analysis() FROM PUBLIC,anon,authenticated;
COMMIT;
