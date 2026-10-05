-- School branding: the logo itself (small PNG/JPEG, ≤ 512 KB). Kept in its
-- own table so the frequently-read tenants row never carries image bytes.
-- Written and served by the server only (after the school admin's
-- permission check); school sessions have no direct access.
CREATE TABLE "tenant_logos" (
    "tenantId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_logos_pkey" PRIMARY KEY ("tenantId"),
    CONSTRAINT "tenant_logos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tenant_logos_type" CHECK ("contentType" IN ('image/png', 'image/jpeg')),
    CONSTRAINT "tenant_logos_size" CHECK ("sizeBytes" = octet_length("data") AND "sizeBytes" BETWEEN 1 AND 524288),
    CONSTRAINT "tenant_logos_sha" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
ALTER TABLE "tenant_logos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_logos" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE ALL ON "tenant_logos" FROM educore_app;
  END IF;
END $$;
