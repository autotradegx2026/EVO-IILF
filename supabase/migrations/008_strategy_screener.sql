-- Client PRD defaults for NEW accounts only. Preserve existing user choices.
ALTER TABLE public.settings
  ALTER COLUMN trend_ema_length SET DEFAULT 200,
  ALTER COLUMN htf_ema_length SET DEFAULT 50,
  ALTER COLUMN htf_timeframe SET DEFAULT '1H',
  ALTER COLUMN adx_threshold SET DEFAULT 20,
  ALTER COLUMN rr_ratio SET DEFAULT 3,
  ALTER COLUMN cooldown_bars SET DEFAULT 10,
  ALTER COLUMN session_start SET DEFAULT '09:30:00',
  ADD COLUMN IF NOT EXISTS adx_length smallint NOT NULL DEFAULT 14 CHECK (adx_length BETWEEN 2 AND 50),
  ADD COLUMN IF NOT EXISTS atr_length smallint NOT NULL DEFAULT 14 CHECK (atr_length BETWEEN 2 AND 50),
  ADD COLUMN IF NOT EXISTS delta_length smallint NOT NULL DEFAULT 14 CHECK (delta_length BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS swing_lookback smallint NOT NULL DEFAULT 10 CHECK (swing_lookback BETWEEN 2 AND 100),
  ADD COLUMN IF NOT EXISTS session_timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (session_timezone IN ('Asia/Kolkata', 'Etc/UTC', 'America/New_York', 'Europe/London')),
  ADD COLUMN IF NOT EXISTS screener_symbols text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (cardinality(screener_symbols) <= 50),
  ADD COLUMN IF NOT EXISTS screener_timeframe text NOT NULL DEFAULT '15m' CHECK (screener_timeframe IN ('1m', '5m', '15m', '1h')),
  ADD COLUMN IF NOT EXISTS signal_delivery_mode text NOT NULL DEFAULT 'signals' CHECK (signal_delivery_mode IN ('signals', 'paper')),
  ADD COLUMN IF NOT EXISTS delivery_token_hash text;

CREATE TABLE public.strategy_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL UNIQUE,
  paper boolean NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'PROCESSING', 'DONE', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  claim_id uuid,
  result jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.strategy_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own strategy inbox" ON public.strategy_inbox FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.strategy_inbox TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_inbox TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.strategy_inbox FROM anon, authenticated;
CREATE INDEX strategy_inbox_pending ON public.strategy_inbox(received_at) WHERE status IN ('QUEUED', 'PROCESSING');

CREATE FUNCTION public.claim_strategy_inbox() RETURNS SETOF public.strategy_inbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A crashed final attempt must become visible as a terminal failure.
  UPDATE public.strategy_inbox SET status = 'FAILED',
    result = jsonb_build_object('error', 'DELIVERY_ATTEMPTS_EXHAUSTED')
  WHERE status = 'PROCESSING' AND claimed_at < now() - interval '2 minutes' AND attempts >= 3;

  RETURN QUERY
  UPDATE public.strategy_inbox q SET status = 'PROCESSING', claimed_at = now(),
    claim_id = gen_random_uuid(), attempts = q.attempts + 1
  WHERE q.id IN (
    SELECT id FROM public.strategy_inbox
    WHERE (status = 'QUEUED' OR (status = 'PROCESSING' AND claimed_at < now() - interval '2 minutes')) AND attempts < 3
    ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 10
  ) RETURNING q.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_strategy_inbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_strategy_inbox() TO service_role;
