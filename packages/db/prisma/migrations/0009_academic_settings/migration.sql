-- Phase 2, milestone 2.0: academic settings.
--   * terms per academic year (one current term per school)
--   * grading scale (grade bands)
--   * school-editable academic options (separate from tenants.settings,
--     which also holds platform-only plan/feature switches)
--   * form teacher per section
--   * assessment types become score components (weight = max marks of 100)
-- Every new table is tenant-owned: RLS forced, same policy as the others.

-- Terms --------------------------------------------------------------------
CREATE TABLE "terms" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "order"          INTEGER NOT NULL,
  "startDate"      DATE NOT NULL,
  "endDate"        DATE NOT NULL,
  "isCurrent"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "terms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "terms_dates_check" CHECK ("endDate" > "startDate"),
  CONSTRAINT "terms_order_check" CHECK ("order" BETWEEN 1 AND 12)
);
CREATE UNIQUE INDEX "terms_tenantId_academicYearId_name_key" ON "terms" ("tenantId", "academicYearId", "name");
CREATE UNIQUE INDEX "terms_tenantId_academicYearId_order_key" ON "terms" ("tenantId", "academicYearId", "order");
CREATE INDEX "terms_tenantId_idx" ON "terms" ("tenantId");
CREATE INDEX "terms_tenantId_academicYearId_idx" ON "terms" ("tenantId", "academicYearId");
-- At most one current term per school.
CREATE UNIQUE INDEX "terms_one_current_per_tenant" ON "terms" ("tenantId") WHERE "isCurrent";
ALTER TABLE "terms" ADD CONSTRAINT "terms_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terms" ADD CONSTRAINT "terms_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grade bands --------------------------------------------------------------
CREATE TABLE "grade_bands" (
  "id"       TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "minScore" DOUBLE PRECISION NOT NULL,
  "grade"    TEXT NOT NULL,
  "remark"   TEXT,
  CONSTRAINT "grade_bands_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grade_bands_min_check" CHECK ("minScore" >= 0 AND "minScore" <= 100)
);
CREATE UNIQUE INDEX "grade_bands_tenantId_minScore_key" ON "grade_bands" ("tenantId", "minScore");
CREATE UNIQUE INDEX "grade_bands_tenantId_grade_key" ON "grade_bands" ("tenantId", "grade");
CREATE INDEX "grade_bands_tenantId_idx" ON "grade_bands" ("tenantId");
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Academic settings (one row per school) -----------------------------------
CREATE TABLE "academic_settings" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "showPosition"       BOOLEAN NOT NULL DEFAULT false,
  "attendanceEditDays" INTEGER NOT NULL DEFAULT 7,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "academic_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "academic_settings_edit_days_check" CHECK ("attendanceEditDays" BETWEEN 0 AND 60)
);
CREATE UNIQUE INDEX "academic_settings_tenantId_key" ON "academic_settings" ("tenantId");
ALTER TABLE "academic_settings" ADD CONSTRAINT "academic_settings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Form teacher ---------------------------------------------------------------
ALTER TABLE "sections" ADD COLUMN "formTeacherId" TEXT;
ALTER TABLE "sections" ADD CONSTRAINT "sections_formTeacherId_fkey"
  FOREIGN KEY ("formTeacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sections_formTeacherId_idx" ON "sections" ("formTeacherId");

-- Score components ------------------------------------------------------------
-- Old demo data stored weights as fractions (0.4); the new meaning is
-- "maximum marks out of 100" (40).
UPDATE "assessment_types" SET "weight" = "weight" * 100 WHERE "weight" > 0 AND "weight" <= 1;
ALTER TABLE "assessment_types" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "assessment_types" ADD CONSTRAINT "assessment_types_weight_check" CHECK ("weight" > 0 AND "weight" <= 100);
CREATE UNIQUE INDEX "assessment_types_tenantId_name_key" ON "assessment_types" ("tenantId", "name");

-- Row level security ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['terms', 'grade_bands', 'academic_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_setting('app.tenant_id', true))
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO educore_app', t);
  END LOOP;
END $$;
