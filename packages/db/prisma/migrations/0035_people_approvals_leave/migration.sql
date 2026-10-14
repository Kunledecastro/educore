-- Phase 8.2: people and communication approvals, and staff leave.

-- Approval requests can now hold pupil status changes, teachers' school-wide
-- announcements and staff leave.
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_process";
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_process"
  CHECK ("process" IN ('DISCOUNT_ASSIGN', 'DISCOUNT_RULE', 'INVOICE_CANCEL', 'PAYMENT_REVERSAL', 'RESULTS_PUBLISH', 'RESULTS_UNPUBLISH', 'STUDENT_STATUS', 'ANNOUNCEMENT_SCHOOL', 'LEAVE'));

CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysPerYear" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_types_days" CHECK ("daysPerYear" BETWEEN 0 AND 366),
    CONSTRAINT "leave_types_name" CHECK (length(btrim("name")) BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX "leave_types_tenantId_name_key" ON "leave_types"("tenantId", "name");
CREATE INDEX "leave_types_tenantId_idx" ON "leave_types"("tenantId");
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "staff_leave" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_leave_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_leave_dates" CHECK ("endDate" >= "startDate"),
    CONSTRAINT "staff_leave_days" CHECK ("days" BETWEEN 1 AND 366),
    CONSTRAINT "staff_leave_status" CHECK ("status" IN ('APPROVED', 'CANCELLED'))
);
CREATE INDEX "staff_leave_tenantId_idx" ON "staff_leave"("tenantId");
CREATE INDEX "staff_leave_tenantId_userId_academicYearId_idx" ON "staff_leave"("tenantId", "userId", "academicYearId");
CREATE INDEX "staff_leave_tenantId_startDate_endDate_idx" ON "staff_leave"("tenantId", "startDate", "endDate");
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_types" FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff_leave" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_leave" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_types"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation ON "staff_leave"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    -- Leave types are edited and switched off, never deleted (leave refers to them);
    -- approved leave is cancelled, never deleted.
    REVOKE ALL ON "leave_types", "staff_leave" FROM educore_app;
    GRANT SELECT, INSERT, UPDATE ON "leave_types" TO educore_app;
    GRANT SELECT, INSERT, UPDATE ON "staff_leave" TO educore_app;
  END IF;
END $$;
