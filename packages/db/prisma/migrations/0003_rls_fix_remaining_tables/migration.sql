-- Follow-up to 0002_rls, applied after Supabase's security advisor flagged
-- two real gaps in the first pass (both confirmed and fixed against the
-- live `educore-greenfield` project, then backfilled here so a fresh
-- `prisma migrate deploy` reproduces the same, verified state):
--
-- 1. `rls_disabled_in_public` ERRORs on tenants, subscriptions, accounts,
--    verification_tokens. These were deliberately left out of 0002's loop
--    as "platform-level, not tenant-owned" — but Supabase's advisor is
--    right that ANY table in the `public` schema is auto-exposed via
--    PostgREST unless RLS is enabled, regardless of whether it happens to
--    carry a tenantId column. Fix: enable RLS with NO permissive policy on
--    each — a safe default-deny (only the service-role/direct Postgres
--    connection the app itself uses can read them; PostgREST's anon/
--    authenticated roles get nothing).
--
-- 2. `thread_participants` was missed entirely from 0002's tenant-owned
--    table list because it has no `tenantId` column of its own — it's a
--    join table (threadId, userId). Fix: a tenant-isolation policy scoped
--    through its parent `message_threads.tenantId` via EXISTS, so a
--    participant row is visible/writable only when the thread it belongs
--    to belongs to the caller's tenant.
--
-- Also fixes a `function_search_path_mutable` WARN on the audit-log
-- immutability trigger function (0002) by pinning its search_path — an
-- unpinned search_path on a SECURITY DEFINER-adjacent function is a
-- privilege-escalation vector if a malicious schema is ever added ahead of
-- `public` in some other role's search_path.

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" ENABLE ROW LEVEL SECURITY;
-- Intentionally no CREATE POLICY here: RLS enabled with zero permissive
-- policies is a default-deny for every role except the table owner /
-- direct Postgres connection (which is what the app itself uses).

ALTER TABLE "thread_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "thread_participants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "thread_participants"
  USING (
    EXISTS (
      SELECT 1 FROM "message_threads" mt
      WHERE mt.id = "thread_participants"."threadId"
        AND mt."tenantId" = current_setting('app.tenant_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "message_threads" mt
      WHERE mt.id = "thread_participants"."threadId"
        AND mt."tenantId" = current_setting('app.tenant_id', true)
    )
  );

ALTER FUNCTION audit_logs_immutable() SET search_path = public;
