-- Apply after 004. Existing duplicate open trades must be reconciled before applying.
BEGIN;
ALTER TABLE public.paper_trades ADD COLUMN IF NOT EXISTS payload_hash varchar(64);
CREATE UNIQUE INDEX paper_payload_hash_unique ON public.paper_trades(payload_hash) WHERE payload_hash IS NOT NULL;
CREATE UNIQUE INDEX one_open_paper_trade ON public.paper_trades(user_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX one_active_live_trade ON public.trades(user_id) WHERE status IN ('PENDING', 'OPEN', 'PARTIAL');
CREATE UNIQUE INDEX one_execution_per_signal ON public.trades(signal_id) WHERE signal_id IS NOT NULL;
CREATE UNIQUE INDEX one_position_per_trade ON public.positions(trade_id);
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS close_order_id varchar(100);
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS execution_error text;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS exchange varchar(10) NOT NULL DEFAULT 'NSE';
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS closing_requested boolean NOT NULL DEFAULT false;

-- Clients cannot forge audit records or bypass server risk checks through PostgREST.
DROP POLICY IF EXISTS signals_insert_own ON public.signals;
DROP POLICY IF EXISTS trades_insert_own ON public.trades;
DROP POLICY IF EXISTS trades_update_own ON public.trades;
DROP POLICY IF EXISTS positions_insert_own ON public.positions;
DROP POLICY IF EXISTS positions_update_own ON public.positions;
DROP POLICY IF EXISTS users_update_own ON public.users;
-- Profile is mirrored from verified auth updates; role and active flag remain server managed.
CREATE OR REPLACE FUNCTION public.sync_auth_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.users SET email = NEW.email, full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email) WHERE id = NEW.id;
  RETURN NEW;
END; $$;
CREATE TRIGGER sync_auth_profile AFTER UPDATE OF email, raw_user_meta_data ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_auth_profile();
ALTER FUNCTION public.handle_new_user() SET search_path = public;

CREATE TABLE public.webhook_rate_limits (
  key text PRIMARY KEY, window_start timestamptz NOT NULL, requests integer NOT NULL
);
ALTER TABLE public.webhook_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.consume_webhook_rate(p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.webhook_rate_limits WHERE window_start < now() - interval '2 minutes';
  INSERT INTO public.webhook_rate_limits AS r VALUES (p_key, date_trunc('minute', now()), 1)
  ON CONFLICT (key) DO UPDATE SET requests = CASE WHEN r.window_start = date_trunc('minute', now()) THEN r.requests + 1 ELSE 1 END,
    window_start = date_trunc('minute', now()) RETURNING requests INTO n;
  RETURN n <= 60;
END; $$;
REVOKE ALL ON FUNCTION public.consume_webhook_rate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_webhook_rate(text) TO service_role;

-- A single transaction reserves an execution before any broker side effect.
CREATE OR REPLACE FUNCTION public.reserve_trade(p_user_id uuid, p_signal_id uuid, p_broker_id uuid, p_quantity numeric, p_exchange text)
RETURNS public.trades LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.signals; t public.trades;
BEGIN
  PERFORM 1 FROM public.settings WHERE user_id = p_user_id AND NOT kill_switch_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_DISABLED'; END IF;
  SELECT * INTO s FROM public.signals WHERE id = p_signal_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR s.is_executed OR s.state NOT IN ('LONG_READY', 'SHORT_READY') THEN RAISE EXCEPTION 'SIGNAL_NOT_EXECUTABLE'; END IF;
  IF s.received_at < now() - interval '5 minutes' THEN RAISE EXCEPTION 'SIGNAL_EXPIRED'; END IF;
  PERFORM 1 FROM public.broker_accounts WHERE id = p_broker_id AND user_id = p_user_id AND is_active AND is_connected;
  IF NOT FOUND OR p_quantity <= 0 THEN RAISE EXCEPTION 'INVALID_EXECUTION'; END IF;
  INSERT INTO public.trades(user_id, signal_id, broker_account_id, symbol, direction, entry_price, stop_loss, take_profit, quantity, confluence_score, status, exchange)
  VALUES (p_user_id, s.id, p_broker_id, s.symbol, s.direction, s.entry_price, s.stop_loss, s.take_profit, p_quantity, s.confluence_score, 'PENDING', p_exchange) RETURNING * INTO t;
  UPDATE public.signals SET is_executed = true WHERE id = s.id;
  RETURN t;
END; $$;
REVOKE ALL ON FUNCTION public.reserve_trade(uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_trade(uuid, uuid, uuid, numeric, text) TO service_role;

-- Enable dashboard subscriptions explicitly.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['signals','positions','trades','alerts','webhook_logs','paper_trades'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
-- Store intake, audit and alert atomically so a retry cannot strand half a webhook.
CREATE OR REPLACE FUNCTION public.persist_webhook(p_user_id uuid, p_paper boolean, p_payload jsonb, p_hash text, p_state text, p_quantity numeric, p_risk numeric, p_ip text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result_id uuid; rr numeric; direction text;
BEGIN
  direction := p_payload->>'action';
  IF direction IN ('LONG', 'SHORT') THEN
    rr := abs((p_payload->>'tp')::numeric - (p_payload->>'price')::numeric) / nullif(abs((p_payload->>'price')::numeric - (p_payload->>'sl')::numeric), 0);
  END IF;
  IF p_paper AND direction IN ('LONG', 'SHORT') THEN
    INSERT INTO public.paper_trades(user_id, symbol, direction, entry_price, stop_loss, take_profit, quantity, initial_capital, risk_percent, rr_ratio, confluence_score, payload_hash, notes)
    VALUES(p_user_id, p_payload->>'symbol', direction, (p_payload->>'price')::numeric, (p_payload->>'sl')::numeric, (p_payload->>'tp')::numeric, p_quantity, 100000, p_risk, rr, (p_payload->>'confluence')::integer, p_hash, 'Simulated webhook fill at signal price') RETURNING id INTO result_id;
  ELSIF NOT p_paper THEN
    INSERT INTO public.signals(user_id, symbol, direction, state, entry_price, stop_loss, take_profit, confluence_score, rr_ratio, timeframe, payload_hash, raw_payload)
    VALUES(p_user_id, p_payload->>'symbol', CASE WHEN direction IN ('LONG','SHORT') THEN direction ELSE 'WAIT' END, p_state,
      (p_payload->>'price')::numeric, (p_payload->>'sl')::numeric, (p_payload->>'tp')::numeric, (p_payload->>'confluence')::integer,
      rr, p_payload->>'tf', p_hash, p_payload) RETURNING id INTO result_id;
  END IF;
  INSERT INTO public.webhook_logs(user_id, raw_payload, status, signal_id, ip_address, processed_at)
  VALUES(p_user_id, p_payload || jsonb_build_object('is_paper', p_paper), 'PROCESSED', CASE WHEN p_paper THEN NULL ELSE result_id END, p_ip, now());
  IF direction IN ('LONG','SHORT') THEN
    INSERT INTO public.alerts(user_id, type, title, message)
    VALUES(p_user_id, CASE WHEN direction = 'LONG' THEN 'LONG_ENTRY' ELSE 'SHORT_ENTRY' END,
      CASE WHEN p_paper THEN 'PAPER ' ELSE '' END || direction || ' — ' || (p_payload->>'symbol'),
      CASE WHEN p_paper THEN 'Simulated trade opened. ' ELSE 'Signal ready for your confirmation. ' END || 'Entry ' || (p_payload->>'price') || '; SL ' || (p_payload->>'sl') || '; TP ' || (p_payload->>'tp'));
  END IF;
  RETURN result_id;
END; $$;
REVOKE ALL ON FUNCTION public.persist_webhook(uuid, boolean, jsonb, text, text, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_webhook(uuid, boolean, jsonb, text, text, numeric, numeric, text) TO service_role;
COMMIT;
