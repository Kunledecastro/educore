-- Phase 8.0: approval workflows (maker-checker). Additive.

-- One request = one sensitive action waiting for approval. It holds exactly
-- what was asked (payload) and a display snapshot (summary); nothing changes
-- in the school's data until the final approval applies it.
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "process" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "amountMinor" BIGINT,
    "stepsRequired" INTEGER NOT NULL DEFAULT 1,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL DEFAULT '',
    "requestedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "approval_requests_process" CHECK ("process" IN ('DISCOUNT_ASSIGN', 'DISCOUNT_RULE', 'INVOICE_CANCEL', 'PAYMENT_REVERSAL')),
    CONSTRAINT "approval_requests_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'FAILED')),
    CONSTRAINT "approval_requests_steps" CHECK ("stepsRequired" BETWEEN 1 AND 2 AND "currentStep" BETWEEN 1 AND "stepsRequired"),
    CONSTRAINT "approval_requests_amount" CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0),
    CONSTRAINT "approval_requests_note" CHECK (char_length("note") <= 500),
    CONSTRAINT "approval_requests_target" CHECK (char_length("targetKey") BETWEEN 1 AND 200)
);
CREATE INDEX "approval_requests_tenantId_status_createdAt_idx" ON "approval_requests"("tenantId", "status", "createdAt");
CREATE INDEX "approval_requests_tenantId_requestedById_idx" ON "approval_requests"("tenantId", "requestedById");
-- At most one pending request for the same thing (e.g. two cancellations of one invoice).
CREATE UNIQUE INDEX "approval_requests_one_pending" ON "approval_requests"("tenantId", "process", "targetKey") WHERE "status" = 'PENDING';

-- Each decision on a request. Never changed afterwards.
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "approverId" TEXT,
    "decision" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_decisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "approval_decisions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "approval_decisions_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "approval_decisions_decision" CHECK ("decision" IN ('APPROVE', 'REJECT')),
    CONSTRAINT "approval_decisions_step" CHECK ("step" BETWEEN 1 AND 2),
    CONSTRAINT "approval_decisions_comment" CHECK (char_length("comment") <= 500)
);
CREATE INDEX "approval_decisions_tenantId_requestId_idx" ON "approval_decisions"("tenantId", "requestId");
-- One decision per step per request.
CREATE UNIQUE INDEX "approval_decisions_requestId_step_key" ON "approval_decisions"("requestId", "step");

CREATE OR REPLACE FUNCTION approval_decisions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'approval_decisions is append-only: UPDATE is not permitted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER approval_decisions_no_update BEFORE UPDATE ON "approval_decisions" FOR EACH ROW EXECUTE FUNCTION approval_decisions_immutable();

-- School data like any other: tenant isolation by RLS for the app's role.
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "approval_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_requests"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation ON "approval_decisions"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    -- Exactly these rights, whatever the database's default grants: requests are
    -- never deleted, decisions never changed or deleted.
    REVOKE ALL ON "approval_requests", "approval_decisions" FROM educore_app;
    GRANT SELECT, INSERT, UPDATE ON "approval_requests" TO educore_app;
    GRANT SELECT, INSERT ON "approval_decisions" TO educore_app;
  END IF;
END $$;

-- The plan catalogue gains an "approvals" module (Free trial, Standard, Premium).
ALTER TABLE "plans" DROP CONSTRAINT "plans_modules_known";
ALTER TABLE "plans" ADD CONSTRAINT "plans_modules_known" CHECK ("modules" <@ ARRAY['attendance','assessments','reportCards','timetable','fees','onlinePayments','messaging','assignments','health','approvals']::TEXT[]);
UPDATE "plans" SET "modules" = array_append("modules", 'approvals') WHERE "code" IN ('FREE_TRIAL', 'STANDARD', 'PREMIUM') AND NOT ('approvals' = ANY ("modules"));
