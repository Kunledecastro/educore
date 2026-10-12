-- Sample data for trial schools (tester review, Oct 2026).
-- Every record created by "Load sample data" is listed here, so "Remove
-- sample data" deletes exactly those records and nothing the school added.

CREATE TABLE "sample_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sample_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sample_records_model_check" CHECK ("model" IN ('User', 'Subject', 'ClassGrade', 'Student', 'AssessmentType', 'Assessment'))
);

CREATE UNIQUE INDEX "sample_records_tenantId_model_recordId_key" ON "sample_records"("tenantId", "model", "recordId");
CREATE INDEX "sample_records_tenantId_idx" ON "sample_records"("tenantId");

ALTER TABLE "sample_records" ADD CONSTRAINT "sample_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sample_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sample_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sample_records"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    -- The app adds and removes its own markers; it never edits them.
    REVOKE ALL ON "sample_records" FROM educore_app;
    GRANT SELECT, INSERT, DELETE ON "sample_records" TO educore_app;
  END IF;
END $$;
