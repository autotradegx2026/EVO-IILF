BEGIN;
-- Preserve ownership policies and audit history while restricting the application
-- to the configured personal account, including previously issued JWTs.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity
  LOOP
    EXECUTE format('CREATE POLICY personal_workspace_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (lower((select auth.jwt())->>''email'')=''autotradegx2026@gmail.com'') WITH CHECK (lower((select auth.jwt())->>''email'')=''autotradegx2026@gmail.com'')',t.relname);
  END LOOP;
END $$;
CREATE POLICY personal_workspace_only ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (lower((select auth.jwt())->>'email')='autotradegx2026@gmail.com')
  WITH CHECK (lower((select auth.jwt())->>'email')='autotradegx2026@gmail.com');

-- Disable new entries for earlier accounts; retain positions and exit monitoring.
UPDATE public.users SET is_active=false WHERE lower(email)<>'autotradegx2026@gmail.com';
UPDATE public.settings SET kill_switch_active=true,paper_auto_scan=false
  WHERE user_id IN (SELECT id FROM public.users WHERE lower(email)<>'autotradegx2026@gmail.com');
UPDATE public.execution_settings SET auto_enabled=false
  WHERE user_id IN (SELECT id FROM public.users WHERE lower(email)<>'autotradegx2026@gmail.com');
COMMIT;
