-- All fixtures are rolled back. This test cannot reach a broker API.
BEGIN;
DO $$
DECLARE uid uuid:=gen_random_uuid(); before_time timestamptz; revision timestamptz; payload jsonb; tid uuid;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(uid,'signal-fence-'||uid||'@example.invalid','{}');
 DELETE FROM settings WHERE user_id=uid;
 INSERT INTO settings(user_id,execution_config_updated_at) VALUES(uid,now()-interval '1 hour');
 UPDATE settings SET risk_percent=0.5 WHERE user_id=uid;
 IF (SELECT execution_config_updated_at FROM settings WHERE user_id=uid)<>now() THEN RAISE EXCEPTION 'risk settings did not advance configuration revision'; END IF;
 UPDATE settings SET session_start='00:00',session_end='00:00',session_timezone='Etc/UTC',paper_trading_enabled=true,paper_auto_scan=true,paper_symbols=ARRAY['BINANCE:BTCUSDT'],paper_timeframe='1m' WHERE user_id=uid;
 SELECT execution_config_updated_at INTO before_time FROM settings WHERE user_id=uid;
 UPDATE settings SET paper_last_scan_at=now(),paper_scan_error='example',paper_started_at=now() WHERE user_id=uid;
 IF (SELECT execution_config_updated_at FROM settings WHERE user_id=uid) IS DISTINCT FROM before_time THEN RAISE EXCEPTION 'paper operational updates invalidate broker configuration'; END IF;
 payload:=jsonb_build_object('symbol','BINANCE:BTCUSDT','action','LONG','price',50000,'sl',49000,'tp',53000,'confluence',7,'tf','1m','timestamp',now(),'_execution_config_updated_at',before_time-interval '1 second');
 BEGIN
  PERFORM persist_webhook(uid,true,payload,md5(gen_random_uuid()::text),'LONG_READY',NULL,1,'paper-scanner');
  RAISE EXCEPTION 'stale native analysis accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'STRATEGY_CHANGED_WAIT_FOR_NEW_SIGNAL' THEN RAISE; END IF; END;
 payload:=payload||jsonb_build_object('_execution_config_updated_at',before_time);
 tid:=persist_webhook(uid,true,payload,md5(gen_random_uuid()::text),'LONG_READY',NULL,1,'paper-scanner');
 IF NOT EXISTS(SELECT 1 FROM paper_trades WHERE id=tid AND status='OPEN') THEN RAISE EXCEPTION 'current native analysis not dispatched'; END IF;
 IF has_function_privilege('service_role','public.persist_webhook_before_configuration_fence(uuid,boolean,jsonb,text,text,numeric,numeric,text)','EXECUTE') THEN RAISE EXCEPTION 'old native entry function bypasses revision check'; END IF;
END $$;
ROLLBACK;
SELECT 'signal configuration fence assertions passed' AS result;
