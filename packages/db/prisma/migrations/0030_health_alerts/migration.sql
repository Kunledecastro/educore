-- Phase 7.1: health alerts (what teachers need to act on). Additive.
CREATE TABLE "health_alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "textEnc" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "health_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "health_alerts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "health_alerts_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "health_alerts_category" CHECK ("category" IN ('ALLERGY', 'ASTHMA', 'SICKLE_CELL', 'DIABETES', 'EPILEPSY', 'OTHER')),
    CONSTRAINT "health_alerts_severity" CHECK ("severity" IN ('MILD', 'MODERATE', 'SEVERE')),
    CONSTRAINT "health_alerts_enc" CHECK ("textEnc" LIKE 'v1.%' AND char_length("textEnc") <= 4000)
);
CREATE INDEX "health_alerts_tenantId_studentId_idx" ON "health_alerts"("tenantId", "studentId");

-- Same lock-down as the other health tables: only the server's health module reads it.
ALTER TABLE "health_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_alerts" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE ALL ON "health_alerts" FROM educore_app;
  END IF;
END $$;
