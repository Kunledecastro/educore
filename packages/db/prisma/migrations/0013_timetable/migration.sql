-- Phase 2, milestone 2.4: timetable (additive only).
--   * timetable_periods: the school's bell schedule (tenant-owned, forced RLS)
--   * timetable_entries gain academicYearId, and the clash rules become
--     database constraints, so two people saving at once can't double-book:
--       one lesson per section per slot; a teacher once per slot per year;
--       a room once per slot per year (case/space-insensitive name).

CREATE TABLE "timetable_periods" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "number"    INTEGER NOT NULL,
  "label"     TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime"   TEXT NOT NULL,
  "isBreak"   BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "timetable_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "timetable_periods_number_check" CHECK ("number" >= 1),
  CONSTRAINT "timetable_periods_time_check" CHECK (
    "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" > "startTime")
);
CREATE UNIQUE INDEX "timetable_periods_tenantId_number_key" ON "timetable_periods" ("tenantId", "number");
CREATE INDEX "timetable_periods_tenantId_idx" ON "timetable_periods" ("tenantId");
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timetable_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timetable_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "timetable_periods"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "timetable_periods" TO educore_app;

ALTER TABLE "timetable_entries" ADD COLUMN "academicYearId" TEXT;
UPDATE "timetable_entries" e SET "academicYearId" = c."academicYearId" FROM "class_grades" c WHERE c.id = e."classId";
ALTER TABLE "timetable_entries" ALTER COLUMN "academicYearId" SET NOT NULL;
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_slot_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6 AND "period" >= 1);
CREATE UNIQUE INDEX "timetable_entries_tenantId_sectionId_dayOfWeek_period_key"
  ON "timetable_entries" ("tenantId", "sectionId", "dayOfWeek", "period");
CREATE UNIQUE INDEX "timetable_entries_tenantId_academicYearId_teacherId_dayOfWeek_period_key"
  ON "timetable_entries" ("tenantId", "academicYearId", "teacherId", "dayOfWeek", "period");
CREATE UNIQUE INDEX "timetable_entries_room_slot_key"
  ON "timetable_entries" ("tenantId", "academicYearId", lower(regexp_replace(btrim("room"), '\s+', ' ', 'g')), "dayOfWeek", "period")
  WHERE "room" IS NOT NULL AND btrim("room") <> '';
