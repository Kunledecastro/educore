-- Milestone 1.4: onboarding checklist.
--
-- A school admin can hide the setup checklist on their dashboard. That one
-- flag lives on the tenant row, which until now was read-only for the
-- tenant path (`educore_app`, migration 0004). We open exactly one door:
--
--   * column-level privilege: educore_app may UPDATE only
--     "onboardingDismissedAt" and "updatedAt" (Prisma's @updatedAt) — never
--     plan, status, subdomain, settings, branding …
--   * row-level policy: only its own row (id = app.tenant_id).
--
-- The table-wide UPDATE granted in 0004 is revoked first, otherwise the
-- column grant would add nothing.

ALTER TABLE "tenants" ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);

REVOKE UPDATE ON "tenants" FROM educore_app;
GRANT UPDATE ("onboardingDismissedAt", "updatedAt") ON "tenants" TO educore_app;

DROP POLICY IF EXISTS tenant_self_onboarding ON "tenants";
CREATE POLICY tenant_self_onboarding ON "tenants"
  FOR UPDATE TO educore_app
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));
