-- Phase 5 (applied to the Supabase project on 2026-10-05 as migration
-- "0024_storage_bucket"). Supabase-specific — it lives outside prisma/migrations
-- because plain Postgres (tests, other hosts) has no `storage` schema.
--
-- Private bucket for assignment worksheets and submitted work. No public access
-- and no storage policies: only the EduCore server (service key) reads/writes
-- it, and hands out short-lived signed links.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('educore-uploads', 'educore-uploads', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
