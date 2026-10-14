BEGIN;
CREATE TABLE public.mt5_candles (
 account_id uuid NOT NULL REFERENCES public.execution_accounts(id) ON DELETE CASCADE,
 request text NOT NULL, timeframe text NOT NULL,
 bars jsonb NOT NULL CHECK (jsonb_typeof(bars)='array'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,request,timeframe)
);
ALTER TABLE public.mt5_candles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mt5_candles FROM anon, authenticated;
GRANT ALL ON public.mt5_candles TO service_role;
COMMIT;
