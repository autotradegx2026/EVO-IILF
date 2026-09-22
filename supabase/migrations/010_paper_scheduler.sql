-- Scheduler infrastructure only. Activation requires the deployment URL and a
-- CRON_SECRET stored in Vault, after the application has been deployed.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE FUNCTION public.invoke_paper_worker() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE token text; base_url text; request_id bigint;
BEGIN
 SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='evo_paper_cron_secret';
 SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name='evo_paper_app_url';
 IF token IS NULL OR base_url IS NULL THEN RAISE EXCEPTION 'PAPER_SCHEDULER_NOT_CONFIGURED'; END IF;
 SELECT net.http_post(url:=base_url||'/api/jobs/paper',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=60000) INTO request_id;
 RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.invoke_paper_worker() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_paper_worker() TO service_role;
-- Activate with: select cron.schedule('evo-paper-worker','* * * * *','select public.invoke_paper_worker()');
