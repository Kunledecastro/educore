-- Phase 4, milestone 4.0: platform admin console. Additive.
--
-- * platform_audit_logs: everything a platform admin does (suspend, reactivate,
--   impersonate, plan changes…). Platform-level (not tenant-owned): schools
--   never see it. Append-only for everyone, like audit_logs.
-- * impersonation_sessions: a platform admin "signing in as" a school admin
--   for support — time-limited, ended explicitly or by expiry, all audited.
-- * audit_logs.impersonatorId: when a change in a school was made by a
--   platform admin acting as one of its users, the school's own audit log
--   says so (actorId = the account used, impersonatorId = the real person).
--   No FK on purpose: audit rows can never be updated, so ON DELETE SET NULL
--   would block deleting a platform admin.
-- * tenants.suspendedAt / suspendedReason: why a school is suspended.
-- Both new tables have RLS forced with NO policy for the app role: the
-- school-facing role can never read or write them.

ALTER TABLE "audit_logs" ADD COLUMN "impersonatorId" TEXT;

ALTER TABLE "tenants" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "suspendedReason" TEXT;

CREATE TABLE "platform_audit_logs" (
  "id"         TEXT NOT NULL,
  "actorId"    TEXT,
  "action"     TEXT NOT NULL,
  "tenantId"   TEXT,
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "before"     JSONB,
  "after"      JSONB,
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_audit_logs_createdAt_idx" ON "platform_audit_logs" ("createdAt");
CREATE INDEX "platform_audit_logs_tenantId_createdAt_idx" ON "platform_audit_logs" ("tenantId", "createdAt");

CREATE OR REPLACE FUNCTION platform_audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_logs is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER platform_audit_logs_no_update BEFORE UPDATE ON "platform_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION platform_audit_logs_immutable();
CREATE TRIGGER platform_audit_logs_no_delete BEFORE DELETE ON "platform_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION platform_audit_logs_immutable();

CREATE TABLE "impersonation_sessions" (
  "id"              TEXT NOT NULL,
  "platformAdminId" TEXT NOT NULL,
  "targetUserId"    TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "reason"          TEXT NOT NULL,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "endedAt"         TIMESTAMP(3),
  "ipAddress"       TEXT,
  CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "impersonation_sessions_window_check" CHECK ("expiresAt" > "startedAt" AND "expiresAt" <= "startedAt" + INTERVAL '2 hours'),
  CONSTRAINT "impersonation_sessions_reason_check" CHECK (length(btrim("reason")) BETWEEN 3 AND 300)
);
CREATE INDEX "impersonation_sessions_platformAdminId_idx" ON "impersonation_sessions" ("platformAdminId", "startedAt");
CREATE INDEX "impersonation_sessions_tenantId_idx" ON "impersonation_sessions" ("tenantId", "startedAt");
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_platformAdminId_fkey"
  FOREIGN KEY ("platformAdminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "impersonation_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "impersonation_sessions" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "platform_audit_logs", "impersonation_sessions" FROM educore_app;
