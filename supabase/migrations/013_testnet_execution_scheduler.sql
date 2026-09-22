BEGIN;
CREATE TABLE public.execution_worker_requests (
 request_id bigint PRIMARY KEY, requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execution_worker_requests_time ON public.execution_worker_requests(requested_at);
ALTER TABLE public.execution_worker_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.execution_worker_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.execution_worker_requests TO service_role;
CREATE FUNCTION public.invoke_testnet_execution_worker() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE token text; base_url text; request_id bigint;
BEGIN
 -- Avoid redundant HTTP calls while an active worker is renewing its lease.
 IF EXISTS(SELECT 1 FROM execution_worker WHERE name='broker' AND lease_until>now() AND heartbeat_at>now()-interval '8 seconds') THEN RETURN NULL; END IF;
 SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='evo_paper_cron_secret';
 SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name='evo_paper_app_url';
 IF token IS NULL OR base_url IS NULL THEN RAISE EXCEPTION 'WORKER_SCHEDULER_NOT_CONFIGURED'; END IF;
 SELECT net.http_post(url:=base_url||'/api/jobs/execution',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=60000) INTO request_id;
 INSERT INTO execution_worker_requests VALUES(request_id,now());
 RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.invoke_testnet_execution_worker() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_testnet_execution_worker() TO service_role;
-- Activate after the testnet-only HTTP worker is deployed:
-- SELECT cron.schedule('evo-testnet-execution','5 seconds','SELECT public.invoke_testnet_execution_worker()');
-- Daily operator job: prune this request table and this job's cron history after seven days.
COMMIT;
