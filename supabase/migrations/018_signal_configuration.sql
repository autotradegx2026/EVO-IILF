BEGIN;
ALTER TABLE public.settings ADD COLUMN execution_config_updated_at timestamptz NOT NULL DEFAULT now();
UPDATE public.settings SET execution_config_updated_at=updated_at;
CREATE FUNCTION public.stamp_execution_configuration() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (to_jsonb(NEW) - ARRAY['updated_at','execution_config_updated_at','paper_last_scan_at','paper_scan_error','paper_trading_enabled','paper_started_at','paper_stopped_at','paper_auto_scan','paper_symbols','paper_timeframe','webhook_secret','delivery_token_hash']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['updated_at','execution_config_updated_at','paper_last_scan_at','paper_scan_error','paper_trading_enabled','paper_started_at','paper_stopped_at','paper_auto_scan','paper_symbols','paper_timeframe','webhook_secret','delivery_token_hash'])
 THEN NEW.execution_config_updated_at:=now(); ELSE NEW.execution_config_updated_at:=OLD.execution_config_updated_at; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stamp_execution_configuration BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.stamp_execution_configuration();
REVOKE ALL ON FUNCTION public.stamp_execution_configuration() FROM PUBLIC,anon,authenticated;
-- Native analysis binds its saved strategy revision before committing an entry/signal.
ALTER FUNCTION public.persist_webhook(uuid,boolean,jsonb,text,text,numeric,numeric,text) RENAME TO persist_webhook_before_configuration_fence;
CREATE FUNCTION public.persist_webhook(p_user_id uuid,p_paper boolean,p_payload jsonb,p_hash text,p_state text,p_quantity numeric,p_risk numeric,p_ip text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE config_time timestamptz;
BEGIN
 SELECT execution_config_updated_at INTO config_time FROM settings WHERE user_id=p_user_id FOR UPDATE;
 IF p_payload->>'_execution_config_updated_at' IS NOT NULL AND (p_payload->>'_execution_config_updated_at')::timestamptz IS DISTINCT FROM config_time THEN RAISE EXCEPTION 'STRATEGY_CHANGED_WAIT_FOR_NEW_SIGNAL'; END IF;
 RETURN persist_webhook_before_configuration_fence(p_user_id,p_paper,p_payload,p_hash,p_state,p_quantity,p_risk,p_ip);
END $$;
REVOKE ALL ON FUNCTION public.persist_webhook_before_configuration_fence(uuid,boolean,jsonb,text,text,numeric,numeric,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.persist_webhook(uuid,boolean,jsonb,text,text,numeric,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_webhook(uuid,boolean,jsonb,text,text,numeric,numeric,text) TO service_role;
CREATE FUNCTION public.guard_broker_signal_configuration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE config_time timestamptz; sig public.signals;
BEGIN
 SELECT execution_config_updated_at INTO config_time FROM settings WHERE user_id=NEW.user_id FOR UPDATE;
 SELECT * INTO sig FROM signals WHERE id=NEW.signal_id AND user_id=NEW.user_id;
 IF sig.raw_payload->>'_execution_config_updated_at' IS NOT NULL THEN
  IF (sig.raw_payload->>'_execution_config_updated_at')::timestamptz IS DISTINCT FROM config_time THEN RAISE EXCEPTION 'STRATEGY_CHANGED_WAIT_FOR_NEW_SIGNAL'; END IF;
 ELSIF sig.received_at<config_time THEN RAISE EXCEPTION 'STRATEGY_CHANGED_WAIT_FOR_NEW_SIGNAL';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_broker_signal_configuration BEFORE INSERT ON public.broker_executions FOR EACH ROW EXECUTE FUNCTION public.guard_broker_signal_configuration();
REVOKE ALL ON FUNCTION public.guard_broker_signal_configuration() FROM PUBLIC,anon,authenticated;
COMMIT;
