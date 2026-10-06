-- Phase 5.2: handing work in and marking. Additive.

-- Work a teacher records as "not handed in" (scored 0 when the assignment is scored).
ALTER TABLE "assignment_submissions" ADD COLUMN "isMissing" BOOLEAN NOT NULL DEFAULT false;
-- A "not handed in" record is a marked record, never one a student handed in.
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_missing" CHECK (NOT "isMissing" OR "status" = 'MARKED');

-- Uploads that were started but never attached. A daily job deletes the
-- stored object once a pending row is a day old; attaching removes the row.
CREATE TABLE "pending_uploads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pending_uploads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pending_uploads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pending_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "pending_uploads_key" CHECK ("storageKey" LIKE "tenantId" || '/%' AND char_length("storageKey") <= 300)
);
CREATE UNIQUE INDEX "pending_uploads_storageKey_key" ON "pending_uploads"("storageKey");
CREATE INDEX "pending_uploads_tenantId_idx" ON "pending_uploads"("tenantId");
CREATE INDEX "pending_uploads_createdAt_idx" ON "pending_uploads"("createdAt");

ALTER TABLE "pending_uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pending_uploads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pending_uploads"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    GRANT SELECT, INSERT, DELETE ON "pending_uploads" TO educore_app;
  END IF;
END $$;
