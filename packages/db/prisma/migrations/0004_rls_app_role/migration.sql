-- Make Row Level Security actually enforce tenant isolation on the app path.
--
-- FINDING (2026-09-28): 0002_rls assumed the app's connection role would be
-- subject to FORCE ROW LEVEL SECURITY. On Supabase the app connects as
-- `postgres`, which has BYPASSRLS — so every policy was silently skipped and
-- isolation rested on the Prisma extension (layer #1) alone.
--
-- FIX: a dedicated `educore_app` role WITHOUT BYPASSRLS. It cannot log in;
-- the app's existing connection switches to it per transaction with
-- `SET LOCAL ROLE educore_app` alongside `set_config('app.tenant_id', ..., true)`
-- (see packages/db/src/tenant-scope.ts). Both are transaction-local, so they
-- are safe on pgbouncer/Supavisor transaction pooling: nothing leaks into
-- the next request that reuses the connection.
--
-- The platform-admin path deliberately stays on `postgres` (above tenant
-- isolation, architecture rule #1) and is audited at the application layer.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    CREATE ROLE educore_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Let the connecting role switch into educore_app (PG16+ membership syntax).
GRANT educore_app TO postgres WITH INHERIT FALSE, SET TRUE;

GRANT USAGE ON SCHEMA public TO educore_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO educore_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO educore_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO educore_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO educore_app;

-- Platform tables stay default-deny for educore_app, with two narrow,
-- read-only exceptions so tenant-scoped queries can still `include` them:
-- a tenant may read its own tenant row and its own subscription row.
DROP POLICY IF EXISTS tenant_self_read ON tenants;
CREATE POLICY tenant_self_read ON tenants
  FOR SELECT TO educore_app
  USING (id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS subscription_self_read ON subscriptions;
CREATE POLICY subscription_self_read ON subscriptions
  FOR SELECT TO educore_app
  USING ("tenantId" = current_setting('app.tenant_id', true));

-- Tenant-scoped requests must never touch these at all.
REVOKE ALL ON accounts, verification_tokens FROM educore_app;
