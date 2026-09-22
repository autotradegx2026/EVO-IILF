BEGIN;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS screenshot_path text;
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES('trade-screenshots', 'trade-screenshots', false, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
-- All storage access goes through authenticated ownership-checked API routes.
COMMIT;
