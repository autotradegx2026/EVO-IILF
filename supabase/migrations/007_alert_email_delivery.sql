BEGIN;
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS email_last_attempt_at timestamptz;
CREATE OR REPLACE FUNCTION public.claim_email_alerts() RETURNS SETOF public.alerts
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH batch AS (
    SELECT id FROM public.alerts WHERE NOT delivered_email AND email_attempts < 5
      AND created_at > now() - interval '24 hours'
      AND (email_last_attempt_at IS NULL OR email_last_attempt_at < now() - interval '5 minutes')
    ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.alerts SET email_attempts = email_attempts + 1, email_last_attempt_at = now()
  WHERE id IN (SELECT id FROM batch) RETURNING public.alerts.*;
$$;
REVOKE ALL ON FUNCTION public.claim_email_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_alerts() TO service_role;
COMMIT;
