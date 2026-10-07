-- Phase 7.0: the school nurse and pupils' health profiles. Additive.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SCHOOL_NURSE';

-- Health profile: the medical details are one encrypted JSON document
-- (AES-256-GCM, app-level key). Consent is recorded with it. Status tracks
-- the nurse's check of what a parent entered.
CREATE TABLE "health_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dataEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentById" TEXT,
    "consentSource" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "health_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "health_profiles_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "health_profiles_consentById_fkey" FOREIGN KEY ("consentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "health_profiles_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "health_profiles_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "health_profiles_status" CHECK ("status" IN ('SUBMITTED', 'VERIFIED', 'CHANGED')),
    CONSTRAINT "health_profiles_consent_source" CHECK ("consentSource" IN ('ONLINE', 'PAPER')),
    CONSTRAINT "health_profiles_enc" CHECK ("dataEnc" LIKE 'v1.%' AND char_length("dataEnc") <= 200000)
);
CREATE UNIQUE INDEX "health_profiles_studentId_key" ON "health_profiles"("studentId");
CREATE INDEX "health_profiles_tenantId_idx" ON "health_profiles"("tenantId");

-- Doctor's letters, immunisation cards: private storage, health folder only.
CREATE TABLE "health_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "health_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "health_documents_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "health_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "health_documents_key" CHECK ("storageKey" LIKE "tenantId" || '/health/%' AND char_length("storageKey") <= 300),
    CONSTRAINT "health_documents_name" CHECK (char_length("fileName") BETWEEN 1 AND 200),
    CONSTRAINT "health_documents_type" CHECK ("contentType" IN ('application/pdf', 'image/jpeg', 'image/png')),
    CONSTRAINT "health_documents_size" CHECK ("sizeBytes" BETWEEN 1 AND 10485760)
);
CREATE UNIQUE INDEX "health_documents_storageKey_key" ON "health_documents"("storageKey");
CREATE INDEX "health_documents_tenantId_studentId_idx" ON "health_documents"("tenantId", "studentId");

-- Who opened whose health record, and when. Append-only (no UPDATE/DELETE anywhere in the app).
CREATE TABLE "health_access_log" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_access_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "health_access_log_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "health_access_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "health_access_log_action" CHECK (char_length("action") BETWEEN 1 AND 40)
);
CREATE INDEX "health_access_log_tenantId_createdAt_idx" ON "health_access_log"("tenantId", "createdAt");
CREATE INDEX "health_access_log_tenantId_studentId_idx" ON "health_access_log"("tenantId", "studentId");

-- Emergency contacts are not health data: tenant-scoped like other records
-- (teachers need them on the emergency card in 7.1), kept even without consent.
CREATE TABLE "emergency_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "emergency_contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "emergency_contacts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "emergency_contacts_name" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "emergency_contacts_phone" CHECK (char_length("phone") BETWEEN 5 AND 30)
);
CREATE INDEX "emergency_contacts_tenantId_studentId_idx" ON "emergency_contacts"("tenantId", "studentId");

-- Health tables: RLS on with no policies, and the app role has no access at
-- all — only the server's health module (which checks school, role and
-- relationship, and logs reads) can touch them.
ALTER TABLE "health_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "health_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "health_access_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_access_log" FORCE ROW LEVEL SECURITY;
ALTER TABLE "emergency_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "emergency_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "emergency_contacts"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE ALL ON "health_profiles", "health_documents", "health_access_log" FROM educore_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "emergency_contacts" TO educore_app;
  END IF;
END $$;

-- The plan catalogue gains a "health" module (Free trial, Standard, Premium).
ALTER TABLE "plans" DROP CONSTRAINT "plans_modules_known";
ALTER TABLE "plans" ADD CONSTRAINT "plans_modules_known" CHECK ("modules" <@ ARRAY['attendance','assessments','reportCards','timetable','fees','onlinePayments','messaging','assignments','health']::TEXT[]);
UPDATE "plans" SET "modules" = array_append("modules", 'health') WHERE "code" IN ('FREE_TRIAL', 'STANDARD', 'PREMIUM') AND NOT ('health' = ANY ("modules"));
