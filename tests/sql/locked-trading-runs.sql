BEGIN;
DO $$
DECLARE uid uuid:=gen_random_uuid(); aid uuid;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(uid,'run-lock-'||uid||'@example.invalid','{}');
 INSERT INTO execution_accounts(user_id,broker,environment,label,credentials_encrypted,connected) VALUES(uid,'binance','testnet','isolated test','fixture',true) RETURNING id INTO aid;
 PERFORM start_broker_run(uid,aid,'BINANCE:BTCUSDT','5m',50,'fixture');
 IF NOT EXISTS(SELECT 1 FROM settings WHERE user_id=uid AND screener_symbols=ARRAY['BINANCE:BTCUSDT'] AND screener_timeframe='5m' AND signal_delivery_mode='signals') THEN RAISE EXCEPTION 'start did not atomically bind selected chart'; END IF;
 BEGIN
  UPDATE settings SET screener_timeframe='15m' WHERE user_id=uid;
  RAISE EXCEPTION 'running timeframe changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Stop broker trading before changing its strategy, symbol or timeframe.' THEN RAISE; END IF; END;
 BEGIN
  UPDATE execution_settings SET max_price_drift_bps=100 WHERE user_id=uid;
  RAISE EXCEPTION 'running risk limit changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Stop broker trading before changing the selected account or entry limits.' THEN RAISE; END IF; END;
 UPDATE settings SET kill_switch_active=true,paper_last_scan_at=now() WHERE user_id=uid;
 PERFORM stop_broker_automation(uid);
 UPDATE settings SET screener_timeframe='15m',kill_switch_active=false WHERE user_id=uid;
 PERFORM configure_paper_automation(uid,true,true,ARRAY['BINANCE:BTCUSDT'],'15m');
 BEGIN
  UPDATE settings SET min_confluence_score=3 WHERE user_id=uid;
  RAISE EXCEPTION 'running paper strategy changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Stop paper trading before changing its strategy, source, symbols or timeframe.' THEN RAISE; END IF; END;
 PERFORM configure_paper_automation(uid,false);
 UPDATE settings SET min_confluence_score=3 WHERE user_id=uid;
 INSERT INTO paper_observations(user_id,symbol,timeframe,checked_at,bar_close,price,score,status,reasons,analysis) VALUES(uid,'BINANCE:BTCUSDT','15m',now(),now(),100,3,'WAIT',ARRAY['Low confluence'],'{"configRevision":"test-revision","factors":{"trend":true}}');
 UPDATE paper_observations SET checked_at=now()+interval '1 minute' WHERE user_id=uid;
 IF (SELECT count(*) FROM paper_analysis_history WHERE user_id=uid)<>1 THEN RAISE EXCEPTION 'candle audit history duplicated'; END IF;
 IF has_function_privilege('authenticated','public.start_broker_run(uuid,uuid,text,text,integer,text)','EXECUTE') THEN RAISE EXCEPTION 'unsafe start exposed'; END IF;
END $$;
ROLLBACK;
SELECT 'locked run assertions passed' AS result;
