-- Rollback-only integration tests: no fixtures persist and no broker API is contacted.
BEGIN;
DO $$
DECLARE uid uuid:=gen_random_uuid(); tid uuid; result jsonb; payload jsonb; started timestamptz;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(uid,'controls-'||uid||'@example.invalid','{}');
 UPDATE settings SET session_start='00:00',session_end='00:00',session_timezone='Etc/UTC',signal_delivery_mode='signals',screener_symbols=ARRAY['NSE:TEST-EQ'],screener_timeframe='15m',cooldown_bars=0 WHERE user_id=uid;
 PERFORM configure_paper_automation(uid,true,true,ARRAY['BINANCE:BTCUSDT'],'1m');
 IF NOT EXISTS(SELECT 1 FROM settings WHERE user_id=uid AND paper_trading_enabled AND paper_started_at IS NOT NULL AND signal_delivery_mode='signals' AND screener_symbols=ARRAY['NSE:TEST-EQ'] AND screener_timeframe='15m') THEN RAISE EXCEPTION 'paper start changed broker settings'; END IF;
 payload:=jsonb_build_object('symbol','BINANCE:BTCUSDT','action','LONG','price',50000,'sl',49000,'tp',53000,'confluence',7,'tf','1m','timestamp',now()-interval '2 minutes');
 tid:=persist_webhook(uid,true,payload,md5(gen_random_uuid()::text),'LONG_READY',NULL,1,'paper-scanner');
 IF NOT EXISTS(SELECT 1 FROM paper_trades WHERE id=tid AND timeframe='1m' AND source='binance' AND currency='USDT') THEN RAISE EXCEPTION 'paper scanner did not use its own configuration'; END IF;
 PERFORM configure_paper_automation(uid,false);
 IF NOT EXISTS(SELECT 1 FROM settings WHERE user_id=uid AND NOT paper_trading_enabled AND paper_stopped_at IS NOT NULL AND signal_delivery_mode='signals') THEN RAISE EXCEPTION 'paper stop not persisted independently'; END IF;
 BEGIN
  PERFORM persist_webhook(uid,true,payload,md5(gen_random_uuid()::text),'LONG_READY',NULL,1,'paper-scanner');
  RAISE EXCEPTION 'stopped paper entry was accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'PAPER_EXECUTION_DISABLED' THEN RAISE; END IF; END;
 result:=apply_paper_mark(uid,tid,NULL,now()-interval '1 minute',51000,NULL,NULL);
 IF result->>'status'<>'MARKED' THEN RAISE EXCEPTION 'stop disabled marks'; END IF;
 result:=apply_paper_mark(uid,tid,now()-interval '1 minute',now(),53000,53000,'TP_HIT');
 IF result->>'status'<>'CLOSED' OR (result->>'pnl')::numeric<>3000 THEN RAISE EXCEPTION 'stop disabled target exit'; END IF;
 -- An unavailable broker must never prevent disabling automation.
 INSERT INTO execution_settings(user_id,auto_enabled) VALUES(uid,true);
 PERFORM stop_broker_automation(uid);
 IF NOT EXISTS(SELECT 1 FROM execution_settings WHERE user_id=uid AND NOT auto_enabled AND started_at IS NOT NULL AND stopped_at IS NOT NULL) THEN RAISE EXCEPTION 'broker stop failed without credentials'; END IF;
 PERFORM configure_paper_automation(uid,true,true,ARRAY['BINANCE:BTCUSDT'],'1m');
 PERFORM stop_broker_automation(uid);
 IF NOT (SELECT paper_trading_enabled FROM settings WHERE user_id=uid) THEN RAISE EXCEPTION 'broker stop disabled paper'; END IF;
 UPDATE settings SET kill_switch_active=true WHERE user_id=uid;
 PERFORM configure_paper_automation(uid,false);
 BEGIN
  PERFORM configure_paper_automation(uid,true,true,ARRAY['BINANCE:BTCUSDT'],'1m');
  RAISE EXCEPTION 'paper start released global pause';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Release the global entry pause in Risk before starting paper trading.' THEN RAISE; END IF; END;
 IF has_function_privilege('authenticated','public.configure_paper_automation(uuid,boolean,boolean,text[],text)','EXECUTE') OR has_function_privilege('authenticated','public.stop_broker_automation(uuid)','EXECUTE') OR has_table_privilege('authenticated','public.paper_observations','INSERT') THEN RAISE EXCEPTION 'service controls exposed to direct authenticated writes'; END IF;
END $$;
ROLLBACK;
SELECT 'trading control SQL assertions passed' AS result;
