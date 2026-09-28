-- Academic structure integrity (Phase 1, milestone 1.1). Enforced in the
-- database so the rules hold even if application code has a bug or a
-- future import job skips the app's validation.

-- Year names are unique within a school.
CREATE UNIQUE INDEX IF NOT EXISTS "academic_years_tenantId_name_key"
  ON "academic_years" ("tenantId", "name");

-- At most ONE active academic year per school (architecture rule #4).
-- A partial unique index — Prisma's schema language can't express this, so
-- it lives only here; see the note on AcademicYear in schema.prisma.
CREATE UNIQUE INDEX IF NOT EXISTS "academic_years_one_active_per_tenant"
  ON "academic_years" ("tenantId") WHERE "isActive";

-- A year must end after it starts.
ALTER TABLE "academic_years" DROP CONSTRAINT IF EXISTS "academic_years_dates_check";
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_dates_check" CHECK ("endDate" > "startDate");

-- Class names are unique within a school's academic year; section names
-- are unique within a class.
CREATE UNIQUE INDEX IF NOT EXISTS "class_grades_tenantId_academicYearId_name_key"
  ON "class_grades" ("tenantId", "academicYearId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "sections_tenantId_classId_name_key"
  ON "sections" ("tenantId", "classId", "name");

-- A section's capacity, when set, is a positive number.
ALTER TABLE "sections" DROP CONSTRAINT IF EXISTS "sections_capacity_check";
ALTER TABLE "sections" ADD CONSTRAINT "sections_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);
