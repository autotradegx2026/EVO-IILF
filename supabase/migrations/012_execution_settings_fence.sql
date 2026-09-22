BEGIN;
-- Bind an enable action to the exact credentials reviewed by its API request.
-- Lock order matches queue_broker_execution and the credential rotation barrier.
CREATE FUNCTION public.configure_execution_settings(p_user uuid,p_account uuid,p_auto boolean,p_drift integer,p_expected_credentials text)
RETURNS public.execution_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.execution_accounts; s public.settings; result public.execution_settings;
BEGIN
 SELECT * INTO s FROM settings WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_CONFIGURATION_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM execution_accounts WHERE id=p_account AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BROKER_NOT_FOUND'; END IF;
 IF p_auto THEN
  IF a.credentials_encrypted IS DISTINCT FROM p_expected_credentials THEN RAISE EXCEPTION 'BROKER_CHANGED_RETRY'; END IF;
  IF NOT a.connected OR a.error LIKE 'CREDENTIAL_REPLACEMENT:%' THEN RAISE EXCEPTION 'BROKER_NOT_CONNECTED'; END IF;
  IF s.kill_switch_active OR s.signal_delivery_mode<>'signals' OR coalesce(cardinality(s.screener_symbols),0)=0 THEN RAISE EXCEPTION 'CONFIGURE_SIGNAL_MODE_AND_WATCHLIST_FIRST'; END IF;
 END IF;
 INSERT INTO execution_settings(user_id,account_id,auto_enabled,max_price_drift_bps,updated_at)
 VALUES(p_user,p_account,p_auto,p_drift,now()) ON CONFLICT(user_id) DO UPDATE
 SET account_id=excluded.account_id,auto_enabled=excluded.auto_enabled,max_price_drift_bps=excluded.max_price_drift_bps,updated_at=excluded.updated_at RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.configure_execution_settings(uuid,uuid,boolean,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_execution_settings(uuid,uuid,boolean,integer,text) TO service_role;
COMMIT;
