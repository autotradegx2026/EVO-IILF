-- Run after migration 016 with the provisioned owner. No records are created.
BEGIN;
SELECT set_config('request.jwt.claims',json_build_object('sub',id,'email',email,'role','authenticated')::text,true)
  FROM public.users WHERE lower(email)='autotradegx2026@gmail.com';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.users)<>1 OR (SELECT count(*) FROM public.settings)<>1 THEN
    RAISE EXCEPTION 'Personal owner cannot read own profile/settings';
  END IF;
END $$;
-- Even a JWT with a matching row owner cannot pass using a different email.
SELECT set_config('request.jwt.claims',((current_setting('request.jwt.claims')::jsonb)
  || '{"email":"another-account@example.invalid"}'::jsonb)::text,true);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.users) OR EXISTS(SELECT 1 FROM public.settings)
    OR EXISTS(SELECT 1 FROM public.paper_trades) THEN
    RAISE EXCEPTION 'Non-personal identity retains database access';
  END IF;
  UPDATE public.settings SET kill_switch_active=false WHERE user_id=auth.uid();
  IF FOUND THEN RAISE EXCEPTION 'Non-personal identity can update settings'; END IF;
END $$;
ROLLBACK;
