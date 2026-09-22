-- Run inside a transaction and ROLLBACK. This fixture never touches existing users.
DO $$
DECLARE uid uuid:=gen_random_uuid(); tid uuid; payload jsonb; outcome jsonb; quantity numeric; equity numeric;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(uid,'paper-check-'||uid||'@example.invalid','{"full_name":"Paper automation verification"}'::jsonb);
 UPDATE public.settings SET session_start='00:00',session_end='00:00',session_timezone='Etc/UTC',paper_trading_enabled=true,paper_auto_scan=true,paper_symbols=ARRAY['BINANCE:BTCUSDT'],paper_timeframe='1m',signal_delivery_mode='paper',screener_symbols=ARRAY['BINANCE:BTCUSDT'],screener_timeframe='1m',min_confluence_score=5,rr_ratio=3,cooldown_bars=0,max_trades_per_day=20 WHERE user_id=uid;
 payload:=jsonb_build_object('symbol','BINANCE:BTCUSDT','action','LONG','price',50000,'sl',49000,'tp',53000,'confluence',5,'tf','1m','timestamp',now()-interval '2 minutes');
 tid:=public.persist_webhook(uid,true,payload,repeat('a',64),'LONG_READY',NULL,1,'paper-scanner');
 SELECT t.quantity INTO quantity FROM public.paper_trades t WHERE id=tid;
 IF quantity<>1 THEN RAISE EXCEPTION 'fractional sizing test failed: %',quantity; END IF;
 BEGIN
  PERFORM public.persist_webhook(uid,true,payload,repeat('b',64),'LONG_READY',NULL,1,'paper-scanner');
  RAISE EXCEPTION 'duplicate open allowed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'OPEN_POSITION_EXISTS' THEN RAISE; END IF;
 END;
 outcome:=public.apply_paper_mark(uid,tid,NULL,now()-interval '1 minute',51000,NULL,NULL);
 IF outcome->>'status'<>'MARKED' THEN RAISE EXCEPTION 'mark failed'; END IF;
 outcome:=public.apply_paper_mark(uid,tid,NULL,now(),53000,53000,'TP_HIT');
 IF outcome->>'status'<>'STALE_MARK' THEN RAISE EXCEPTION 'stale cursor accepted'; END IF;
 outcome:=public.apply_paper_mark(uid,tid,now()-interval '1 minute',now(),53000,53000,'TP_HIT');
 IF outcome->>'status'<>'CLOSED' OR (outcome->>'pnl')::numeric<>3000 THEN RAISE EXCEPTION 'TP accounting failed'; END IF;
 outcome:=public.apply_paper_mark(uid,tid,now(),now(),49000,49000,'SL_HIT');
 IF outcome->>'status'<>'ALREADY_CLOSED' THEN RAISE EXCEPTION 'duplicate close mutated trade'; END IF;
 payload:=payload||jsonb_build_object('timestamp',now(),'price',100000,'sl',99000,'tp',103000);
 tid:=public.persist_webhook(uid,true,payload,repeat('c',64),'LONG_READY',NULL,1,'paper-scanner');
 SELECT initial_capital,t.quantity INTO equity,quantity FROM public.paper_trades t WHERE id=tid;
 IF equity<>103000 OR quantity<>1.03 THEN RAISE EXCEPTION 'equity compounding failed'; END IF;
 IF has_table_privilege('authenticated','public.paper_trades','INSERT') OR has_table_privilege('authenticated','public.paper_trades','UPDATE') THEN RAISE EXCEPTION 'paper writes exposed'; END IF;
 IF has_function_privilege('authenticated','public.apply_paper_mark(uuid,uuid,timestamp with time zone,timestamp with time zone,numeric,numeric,text)','EXECUTE') THEN RAISE EXCEPTION 'paper mark exposed'; END IF;
END $$;
SELECT 'paper SQL assertions passed' AS result;
