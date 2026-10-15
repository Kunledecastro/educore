-- Phase 9.1: "Remind" on the admin dashboard's registers-not-taken list.
-- One reminder per section per day; kept as a record of who sent it.
CREATE TABLE "register_reminders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "register_reminders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "register_reminders_tenantId_sectionId_date_key" ON "register_reminders"("tenantId", "sectionId", "date");
CREATE INDEX "register_reminders_tenantId_date_idx" ON "register_reminders"("tenantId", "date");
ALTER TABLE "register_reminders" ADD CONSTRAINT "register_reminders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "register_reminders" ADD CONSTRAINT "register_reminders_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "register_reminders" ADD CONSTRAINT "register_reminders_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "register_reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "register_reminders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "register_reminders"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE ALL ON "register_reminders" FROM educore_app;
    GRANT SELECT, INSERT ON "register_reminders" TO educore_app;
  END IF;
END $$;
