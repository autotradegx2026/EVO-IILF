-- Execute after migrations 011–012 inside a transaction; always ROLLBACK fixtures.
DO $$
DECLARE uid uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); account uuid; signal uuid;
 lease uuid; e public.broker_executions; saved public.broker_executions;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(uid,'broker-check-'||uid||'@example.invalid','{"full_name":"Broker SQL verification"}');
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(outsider,'broker-check-'||outsider||'@example.invalid','{"full_name":"Other broker SQL user"}');
 UPDATE settings SET session_start='00:00',session_end='00:00',session_timezone='Etc/UTC',signal_delivery_mode='signals',screener_symbols=ARRAY['BINANCE:BTCUSDT'],screener_timeframe='1m',risk_percent=1,rr_ratio=3,min_confluence_score=5,cooldown_bars=0 WHERE user_id=uid;
 INSERT INTO execution_accounts(user_id,broker,environment,label,credentials_encrypted,connected) VALUES(uid,'binance','testnet','SQL fixture','not-real-credentials',true) RETURNING id INTO account;
 INSERT INTO signals(user_id,symbol,direction,state,entry_price,stop_loss,take_profit,confluence_score,rr_ratio,timeframe,raw_payload)
 VALUES(uid,'BINANCE:BTCUSDT','LONG','LONG_READY',100,98,106,5,3,'1m',jsonb_build_object('timestamp',now())) RETURNING id INTO signal;
 BEGIN
  PERFORM queue_broker_execution(uid,signal,account,1,1000,98,106,'USDT',now()+interval '1 hour',true);
  RAISE EXCEPTION 'automatic entry accepted while off';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'AUTOMATION_DISABLED' THEN RAISE; END IF; END;
 BEGIN
  PERFORM queue_broker_execution(outsider,signal,account,1,1000,98,106,'USDT',now()+interval '1 hour');
  RAISE EXCEPTION 'cross-owner entry accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BROKER_NOT_CONNECTED' THEN RAISE; END IF; END;
 UPDATE signals SET raw_payload='{}' WHERE id=signal;
 BEGIN
  PERFORM queue_broker_execution(uid,signal,account,1,1000,98,106,'USDT',now()+interval '1 hour');
  RAISE EXCEPTION 'missing signal timestamp accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SIGNAL_EXPIRED' THEN RAISE; END IF; END;
 UPDATE signals SET raw_payload=jsonb_build_object('timestamp',now()) WHERE id=signal;
 UPDATE signals SET raw_payload=raw_payload||jsonb_build_object('_execution_config_updated_at',now()-interval '1 hour') WHERE id=signal;
 BEGIN
  PERFORM queue_broker_execution(uid,signal,account,1,1000,98,106,'USDT',now()+interval '1 hour');
  RAISE EXCEPTION 'old strategy revision reached broker queue';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'STRATEGY_CHANGED_WAIT_FOR_NEW_SIGNAL' THEN RAISE; END IF; END;
 UPDATE signals SET raw_payload=jsonb_build_object('timestamp',now()) WHERE id=signal;
 BEGIN
  PERFORM queue_broker_execution(uid,signal,account,10,1000,98,106,'USDT',now()+interval '1 hour');
  RAISE EXCEPTION 'oversized risk accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'RISK_BUDGET_EXCEEDED' THEN RAISE; END IF; END;
 e:=queue_broker_execution(uid,signal,account,1,1000,98,106,'USDT',now()+interval '1 hour');
 IF e.state<>'QUEUED' OR e.risk_budget<>10 OR NOT (SELECT is_executed FROM signals WHERE id=signal) THEN RAISE EXCEPTION 'queue atomicity failed'; END IF;
 BEGIN
  PERFORM queue_broker_execution(uid,signal,account,1,1000,98,106,'USDT',now()+interval '1 hour');
  RAISE EXCEPTION 'duplicate reservation accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SIGNAL_NOT_EXECUTABLE' THEN RAISE; END IF; END;
 lease:=claim_execution_worker(ARRAY['testnet']);
 IF lease IS NULL THEN RAISE EXCEPTION 'stop worker before isolated SQL verification'; END IF;
 IF claim_execution_worker(ARRAY['live']) IS NOT NULL THEN RAISE EXCEPTION 'concurrent lease accepted'; END IF;
 BEGIN
  PERFORM save_broker_execution(gen_random_uuid(),e.id,e.version,to_jsonb(e));
  RAISE EXCEPTION 'wrong lease accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'WORKER_LEASE_LOST' THEN RAISE; END IF; END;
 UPDATE broker_executions SET closing_requested=true WHERE id=e.id;
 saved:=save_broker_execution(lease,e.id,e.version,to_jsonb(e)||jsonb_build_object('user_id',outsider,'requested_quantity',999));
 IF NOT saved.closing_requested OR saved.user_id<>uid OR saved.requested_quantity<>1 OR saved.version<>1 THEN RAISE EXCEPTION 'immutable fields or close request lost'; END IF;
 BEGIN
  PERFORM save_broker_execution(lease,e.id,e.version,to_jsonb(e));
  RAISE EXCEPTION 'stale version accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'EXECUTION_VERSION_CHANGED' THEN RAISE; END IF; END;
 saved.state:='REJECTED';saved:=save_broker_execution(lease,saved.id,saved.version,to_jsonb(saved));
 BEGIN
  PERFORM save_broker_execution(lease,saved.id,saved.version,to_jsonb(saved));
  RAISE EXCEPTION 'terminal mutation accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'EXECUTION_VERSION_CHANGED' THEN RAISE; END IF; END;
 IF has_table_privilege('authenticated','execution_accounts','SELECT') OR has_table_privilege('authenticated','broker_executions','UPDATE') OR has_table_privilege('anon','execution_settings','INSERT') THEN RAISE EXCEPTION 'credential or execution tables exposed'; END IF;
 IF has_function_privilege('authenticated','public.queue_broker_execution(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text,timestamptz,boolean)','EXECUTE') OR has_function_privilege('service_role','public.reserve_trade(uuid,uuid,uuid,numeric,text)','EXECUTE') THEN RAISE EXCEPTION 'unsafe execution function exposed'; END IF;
 BEGIN
  PERFORM configure_execution_settings(uid,account,true,50,'stale-credentials');
  RAISE EXCEPTION 'stale credential enable accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BROKER_CHANGED_RETRY' THEN RAISE; END IF; END;
 PERFORM configure_execution_settings(uid,account,true,50,'not-real-credentials');
 IF NOT (SELECT auto_enabled FROM execution_settings WHERE user_id=uid) THEN RAISE EXCEPTION 'verified configuration save failed'; END IF;
 UPDATE execution_accounts SET connected=false WHERE id=account;
 BEGIN
  PERFORM configure_execution_settings(uid,account,true,50,'not-real-credentials');
  RAISE EXCEPTION 'disconnected configuration enabled';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BROKER_NOT_CONNECTED' THEN RAISE; END IF; END;
 PERFORM configure_execution_settings(uid,account,false,50,'stale-credentials');
 IF (SELECT auto_enabled FROM execution_settings WHERE user_id=uid) THEN RAISE EXCEPTION 'disable unavailable while disconnected'; END IF;
END $$;
SELECT 'broker SQL assertions passed' AS result;
