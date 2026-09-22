BEGIN;
ALTER TABLE public.broker_executions ADD COLUMN notes text, ADD COLUMN screenshot_path text, ADD COLUMN screenshot_url text;
ALTER TABLE public.paper_trades ADD COLUMN screenshot_path text, ADD COLUMN screenshot_url text;
-- Browser roles still cannot write broker or paper trade rows. Authenticated,
-- owner-scoped annotation routes only update these fields, never trading state.
COMMIT;
