-- Import jobs (Phase 1, milestone 1.3 — architecture rules #6 and #7).
-- One row per uploaded CSV: the file itself, its validation report, and the
-- background import's progress. Tenant-owned, so the same RLS policy as
-- every other school table applies — including to the uploaded file.

CREATE TYPE "ImportKind" AS ENUM ('STUDENTS', 'STAFF', 'CLASSES');
CREATE TYPE "ImportStatus" AS ENUM ('VALIDATED', 'QUEUED', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "import_jobs" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "createdById"   TEXT,
  "kind"          "ImportKind" NOT NULL,
  "status"        "ImportStatus" NOT NULL DEFAULT 'VALIDATED',
  "fileName"      TEXT NOT NULL,
  "csv"           TEXT NOT NULL,
  "options"       JSONB NOT NULL DEFAULT '{}',
  "totalRows"     INTEGER NOT NULL DEFAULT 0,
  "validRows"     INTEGER NOT NULL DEFAULT 0,
  "errorRows"     INTEGER NOT NULL DEFAULT 0,
  "processedRows" INTEGER NOT NULL DEFAULT 0,
  "createdRows"   INTEGER NOT NULL DEFAULT 0,
  "updatedRows"   INTEGER NOT NULL DEFAULT 0,
  "failedRows"    INTEGER NOT NULL DEFAULT 0,
  "errors"        JSONB NOT NULL DEFAULT '[]',
  "importErrors"  JSONB NOT NULL DEFAULT '[]',
  "startedAt"     TIMESTAMP(3),
  "finishedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id"),
  -- 2 MB of CSV text, enforced by the database as well as the upload action.
  CONSTRAINT "import_jobs_csv_size_check" CHECK (octet_length("csv") <= 2097152)
);

CREATE INDEX "import_jobs_tenantId_idx" ON "import_jobs" ("tenantId");
CREATE INDEX "import_jobs_tenantId_createdAt_idx" ON "import_jobs" ("tenantId", "createdAt" DESC);
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_jobs"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "import_jobs" TO educore_app;
