-- Run after migration 014. All synthetic ledgers, users and alerts are rolled back.
-- These SQL fixtures exercise bookkeeping only; they cannot place broker orders.
BEGIN;
DO $$
DECLARE
 uid uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); account uuid; sig uuid; eid uuid; tid uuid; probe uuid:=gen_random_uuid();
 fixture record; reason text; before_count bigint; expected_type text; payload jsonb; result jsonb;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data)
 VALUES(uid,'ledger-alerts-'||uid||'@example.invalid','{"full_name":"Ledger alert fixture"}'),
       (outsider,'ledger-alerts-'||outsider||'@example.invalid','{"full_name":"Unrelated fixture owner"}');
 UPDATE public.settings SET session_start='00:00',session_end='00:00',session_timezone='Etc/UTC',
   paper_trading_enabled=true,paper_auto_scan=true,paper_symbols=ARRAY['BINANCE:TESTUSDT'],paper_timeframe='1m',signal_delivery_mode='paper',screener_symbols=ARRAY['BINANCE:TESTUSDT'],screener_timeframe='1m',
   min_confluence_score=5,rr_ratio=3,cooldown_bars=0,max_trades_per_day=20 WHERE user_id=uid;

 FOR fixture IN SELECT * FROM (VALUES
   ('binance','testnet','USDT','BINANCE:TESTUSDT'),('angelone','live','INR','NSE:TEST-EQ')
 ) AS f(broker,environment,currency,symbol) LOOP
   INSERT INTO public.execution_accounts(user_id,broker,environment,label,credentials_encrypted)
   VALUES(uid,fixture.broker,fixture.environment,'Disconnected SQL fixture','not-real-credentials') RETURNING id INTO account;
   FOREACH reason IN ARRAY ARRAY['TP_HIT','SL_HIT','SESSION_END','MANUAL','FILL_RISK_EXCEEDED'] LOOP
     INSERT INTO public.signals(user_id,symbol,direction,state,entry_price,stop_loss,take_profit,confluence_score,rr_ratio)
     VALUES(uid,fixture.symbol,'LONG','LONG_READY',100,95,115,5,3) RETURNING id INTO sig;
     INSERT INTO public.broker_executions(user_id,broker_account_id,signal_id,environment,symbol,direction,currency,
       requested_quantity,signal_price,stop_loss,take_profit,rr,risk_budget,session_start,session_end,session_timezone,deadline_at)
     VALUES(uid,account,sig,fixture.environment,fixture.symbol,'LONG',fixture.currency,
       10,100,95,115,3,50,'00:00','00:00','Etc/UTC',now()+interval '1 hour') RETURNING id INTO eid;
     IF (SELECT count(*) FROM public.alerts WHERE source_id=eid)<>1
       OR NOT EXISTS(SELECT 1 FROM public.alerts WHERE source_id=eid AND metadata->>'event'='QUEUED')
     THEN RAISE EXCEPTION 'queued event missing or duplicated'; END IF;
     UPDATE public.broker_executions SET state='ENTERING',version=version+1 WHERE id=eid;
     UPDATE public.broker_executions SET version=version+1 WHERE id=eid;
     IF (SELECT count(*) FROM public.alerts WHERE source_id=eid)<>1 THEN RAISE EXCEPTION 'ordinary reconciliation created an alert'; END IF;
     UPDATE public.broker_executions SET entry_quantity=3,entry_price=100,residual_quantity=3,version=version+1 WHERE id=eid;
     IF (SELECT count(*) FROM public.alerts WHERE source_id=eid AND metadata->>'event'='PARTIAL_FILL' AND type='LONG_ENTRY'
         AND (metadata->>'entry_quantity')::numeric=3)<>1 THEN RAISE EXCEPTION 'first partial fill event incorrect'; END IF;
     UPDATE public.broker_executions SET entry_quantity=10,residual_quantity=10,version=version+1 WHERE id=eid;
     UPDATE public.broker_executions SET state='PROTECTING',version=version+1 WHERE id=eid;
     UPDATE public.broker_executions SET state='OPEN',version=version+1 WHERE id=eid;
     UPDATE public.broker_executions SET state='OPEN',version=version+1 WHERE id=eid;
     IF (SELECT count(*) FROM public.alerts WHERE source_id=eid)<>3 THEN RAISE EXCEPTION 'fill or OPEN events duplicated'; END IF;

     UPDATE public.broker_executions SET state='ATTENTION',error='FIXTURE_TIMEOUT',version=version+1 WHERE id=eid;
     UPDATE public.broker_executions SET state='ATTENTION',error='FIXTURE_TIMEOUT',version=version+1 WHERE id=eid;
     UPDATE public.broker_executions SET error='FIXTURE_UNKNOWN_ORDER',version=version+1 WHERE id=eid;
     IF (SELECT count(*) FROM public.alerts WHERE source_id=eid AND metadata->>'event'='ATTENTION')<>2 THEN RAISE EXCEPTION 'attention reason transition dedupe failed'; END IF;
     UPDATE public.broker_executions SET state='OPEN',error=NULL,version=version+1 WHERE id=eid;
     UPDATE public.broker_executions SET state='ATTENTION',error='FIXTURE_TIMEOUT',version=version+1 WHERE id=eid;
     IF (SELECT count(*) FROM public.alerts WHERE source_id=eid AND metadata->>'event'='ATTENTION')<>3 THEN RAISE EXCEPTION 'recurring attention after recovery not notified'; END IF;
     IF (SELECT count(*) FROM public.alerts WHERE source_id=eid AND metadata->>'event'='OPEN')<>1 THEN RAISE EXCEPTION 'recovered OPEN resent initial protection'; END IF;

     UPDATE public.broker_executions SET state='CLOSING',error=NULL,close_reason=reason,version=version+1 WHERE id=eid;
     UPDATE public.broker_executions SET state='CLOSED',exit_quantity=9.9,exit_price=115,gross_pnl=148.5,
       quote_fees=1.5,other_fees='{"BNB":0.001}',residual_quantity=0.1,version=version+1 WHERE id=eid;
     UPDATE public.broker_executions SET state='CLOSED',version=version+1 WHERE id=eid;
     expected_type:=CASE WHEN reason IN ('SL_HIT','TP_HIT','SESSION_END') THEN reason ELSE 'EXECUTION_SUCCESS' END;
     IF (SELECT count(*) FROM public.alerts WHERE source_id=eid AND metadata->>'event'='CLOSED' AND type=expected_type
         AND metadata->>'close_reason'=reason AND (metadata->>'gross_pnl')::numeric=148.5
         AND (metadata->>'quote_fees')::numeric=1.5 AND (metadata->>'residual_quantity')::numeric=0.1
         AND metadata->'other_fees'='{"BNB":0.001}'::jsonb)<>1
     THEN RAISE EXCEPTION 'closed event, reason mapping, fees or residual incorrect'; END IF;
     IF EXISTS(SELECT 1 FROM public.alerts WHERE source_id=eid AND (user_id<>uid OR environment<>fixture.environment OR currency<>fixture.currency))
     THEN RAISE EXCEPTION 'broker environment, currency or ownership mixed'; END IF;
     IF EXISTS(SELECT 1 FROM public.alerts WHERE source_id=eid AND (metadata ? 'intents' OR metadata ? 'credentials_encrypted'))
     THEN RAISE EXCEPTION 'sensitive fields copied to alert metadata'; END IF;
     IF NOT EXISTS(SELECT 1 FROM public.alerts WHERE source_id=eid AND metadata->'fee_basis'=to_jsonb(CASE WHEN fixture.broker='angelone' THEN 'gross_only'::text ELSE 'broker_reported'::text END))
     THEN RAISE EXCEPTION 'fee basis not disclosed'; END IF;
   END LOOP;
   INSERT INTO public.signals(user_id,symbol,direction,state,entry_price,stop_loss,take_profit,confluence_score,rr_ratio)
   VALUES(uid,fixture.symbol,'LONG','LONG_READY',100,95,115,5,3) RETURNING id INTO sig;
   INSERT INTO public.broker_executions(user_id,broker_account_id,signal_id,environment,symbol,direction,currency,
     requested_quantity,signal_price,stop_loss,take_profit,rr,risk_budget,session_start,session_end,session_timezone,deadline_at)
   VALUES(uid,account,sig,fixture.environment,fixture.symbol,'LONG',fixture.currency,10,100,95,115,3,50,'00:00','00:00','Etc/UTC',now()+interval '1 hour') RETURNING id INTO eid;
   UPDATE public.broker_executions SET state='REJECTED',error='ENTRY_AUTHORIZATION_CHANGED',version=version+1 WHERE id=eid;
   UPDATE public.broker_executions SET state='REJECTED',version=version+1 WHERE id=eid;
   IF (SELECT count(*) FROM public.alerts WHERE source_id=eid)<>2
     OR NOT EXISTS(SELECT 1 FROM public.alerts WHERE source_id=eid AND metadata->>'event'='REJECTED' AND type='ORDER_REJECTED')
   THEN RAISE EXCEPTION 'rejection event missing or duplicated'; END IF;
 END LOOP;

 -- Each legacy paper RPC must now emit exactly one alert through the ledger trigger.
 FOREACH reason IN ARRAY ARRAY['TP_HIT','SL_HIT','SESSION_END','MANUAL'] LOOP
   payload:=jsonb_build_object('symbol','BINANCE:TESTUSDT','action','LONG','price',100,'sl',95,'tp',115,
     'confluence',5,'tf','1m','timestamp',now()-interval '2 minutes');
   SELECT count(*) INTO before_count FROM public.alerts WHERE user_id=uid;
   tid:=public.persist_webhook(uid,true,payload,md5(gen_random_uuid()::text),'LONG_READY',NULL,1,'paper-scanner');
   IF (SELECT count(*) FROM public.alerts WHERE user_id=uid)<>before_count+1
     OR (SELECT count(*) FROM public.alerts WHERE source_id=tid AND environment='paper' AND currency='USDT' AND metadata->>'event'='OPEN')<>1
   THEN RAISE EXCEPTION 'paper RPC entry alert duplicated or metadata missing'; END IF;
   result:=public.apply_paper_mark(uid,tid,NULL,now()-interval '1 minute',105,NULL,NULL);
   IF result->>'status'<>'MARKED' OR (SELECT count(*) FROM public.alerts WHERE user_id=uid)<>before_count+1
   THEN RAISE EXCEPTION 'paper price mark created a lifecycle alert'; END IF;
   result:=public.apply_paper_mark(uid,tid,now()-interval '1 minute',now(),115,115,reason);
   IF result->>'status'<>'CLOSED' OR (SELECT count(*) FROM public.alerts WHERE user_id=uid)<>before_count+2
   THEN RAISE EXCEPTION 'paper RPC close duplicated or failed'; END IF;
   expected_type:=CASE WHEN reason IN ('SL_HIT','TP_HIT','SESSION_END') THEN reason ELSE 'EXECUTION_SUCCESS' END;
   IF NOT EXISTS(SELECT 1 FROM public.alerts WHERE source_id=tid AND metadata->>'event'='CLOSED' AND type=expected_type
       AND environment='paper' AND currency='USDT' AND metadata->>'close_reason'=reason AND metadata->>'simulated'='true')
   THEN RAISE EXCEPTION 'paper close environment, simulation or reason incorrect'; END IF;
   PERFORM public.apply_paper_mark(uid,tid,now(),now(),95,95,'SL_HIT');
   UPDATE public.paper_trades SET last_checked_at=now() WHERE id=tid;
   IF (SELECT count(*) FROM public.alerts WHERE user_id=uid)<>before_count+2 THEN RAISE EXCEPTION 'paper repeat close duplicated an alert'; END IF;
 END LOOP;

 -- Manual paper entries also get alerts, with quote units derived by the guard.
 INSERT INTO public.paper_trades(user_id,symbol,direction,entry_price,stop_loss,take_profit,quantity)
 VALUES(uid,'NSE:TEST-EQ','SHORT',100,105,85,1) RETURNING id INTO tid;
 IF NOT EXISTS(SELECT 1 FROM public.alerts WHERE source_id=tid AND environment='paper' AND currency='INR' AND type='SHORT_ENTRY')
 THEN RAISE EXCEPTION 'manual Indian paper alert missing'; END IF;
 PERFORM public.apply_paper_mark(uid,tid,NULL,now(),100,100,'MANUAL');
 SELECT count(*) INTO before_count FROM public.alerts WHERE user_id=uid;
 BEGIN
   INSERT INTO public.paper_trades(id,user_id,symbol,direction,entry_price,stop_loss,take_profit,quantity)
   VALUES(probe,uid,'NSE:TEST-EQ','LONG',100,95,115,1);
   IF NOT EXISTS(SELECT 1 FROM public.alerts WHERE source_id=probe) THEN RAISE EXCEPTION 'transaction did not create its alert'; END IF;
   RAISE EXCEPTION 'ROLLBACK_ALERT_FIXTURE';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ROLLBACK_ALERT_FIXTURE' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.paper_trades WHERE id=probe) OR EXISTS(SELECT 1 FROM public.alerts WHERE source_id=probe)
   OR (SELECT count(*) FROM public.alerts WHERE user_id=uid)<>before_count
 THEN RAISE EXCEPTION 'ledger and alert did not roll back together'; END IF;

 INSERT INTO public.alerts(user_id,type,title,message) VALUES(uid,'SYSTEM','Fixture system alert','No known trade provenance');
 IF NOT EXISTS(SELECT 1 FROM public.alerts WHERE user_id=uid AND title='Fixture system alert' AND environment='system'
     AND currency IS NULL AND source_id IS NULL AND event_key IS NULL AND metadata='{}'::jsonb)
 THEN RAISE EXCEPTION 'unknown alerts defaulted to a trading environment'; END IF;
 IF EXISTS(SELECT 1 FROM public.alerts WHERE user_id=outsider) THEN RAISE EXCEPTION 'unrelated user received lifecycle alerts'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.alerts'::regclass)
   OR has_function_privilege('authenticated','public.append_ledger_alert(uuid,text,text,uuid,text,text,text,text,text,jsonb)','EXECUTE')
   OR has_function_privilege('authenticated','public.alert_broker_execution_lifecycle()','EXECUTE')
   OR has_function_privilege('authenticated','public.alert_paper_trade_lifecycle()','EXECUTE')
 THEN RAISE EXCEPTION 'alert RLS or private trigger permissions regressed'; END IF;
END $$;
SELECT 'ledger alert SQL assertions passed; fixtures will be rolled back' AS result;
ROLLBACK;
