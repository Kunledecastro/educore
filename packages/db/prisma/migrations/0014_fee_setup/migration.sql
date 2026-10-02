-- Phase 3, milestone 3.0: fee setup (additive only).
--   * fee_types ("fee items") gain optional / one-off / active flags and an order;
--     names are unique per school.
--   * fee_structures ("fee schedule") gain termId: one amount per item, class and term.
--     Older rows without a term stay readable but are never billed.
--   * discounts (school-defined: % or fixed, optionally limited to one item),
--     student_discounts (who gets which discount, for a term or the whole year),
--     fee_signups (optional items a student is signed up for in a term).
-- Every new table is tenant-owned with FORCED row-level security.

ALTER TABLE "fee_types" ADD COLUMN "isOptional" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "fee_types" ADD COLUMN "isOneOff"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "fee_types" ADD COLUMN "isActive"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "fee_types" ADD COLUMN "order"      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80);
CREATE UNIQUE INDEX "fee_types_tenantId_name_key" ON "fee_types" ("tenantId", "name");

ALTER TABLE "fee_structures" ADD COLUMN "termId" TEXT;
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_amount_check" CHECK ("amount" >= 0);
CREATE UNIQUE INDEX "fee_structures_tenantId_termId_classId_feeTypeId_key"
  ON "fee_structures" ("tenantId", "termId", "classId", "feeTypeId");
CREATE INDEX "fee_structures_tenantId_termId_idx" ON "fee_structures" ("tenantId", "termId");

CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'FIXED');

CREATE TABLE "discounts" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "kind"      "DiscountKind" NOT NULL,
  "value"     DECIMAL(12,2) NOT NULL,
  "feeTypeId" TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "discounts_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  CONSTRAINT "discounts_value_check" CHECK ("value" > 0 AND ("kind" <> 'PERCENT' OR "value" <= 100))
);
CREATE UNIQUE INDEX "discounts_tenantId_name_key" ON "discounts" ("tenantId", "name");
CREATE INDEX "discounts_tenantId_idx" ON "discounts" ("tenantId");
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_feeTypeId_fkey"
  FOREIGN KEY ("feeTypeId") REFERENCES "fee_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "student_discounts" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "studentId"      TEXT NOT NULL,
  "discountId"     TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "termId"         TEXT,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_discounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_discounts_note_check" CHECK ("note" IS NULL OR length("note") <= 200)
);
-- termId NULL = the whole year; one assignment per student, discount and period.
CREATE UNIQUE INDEX "student_discounts_unique_period"
  ON "student_discounts" ("tenantId", "studentId", "discountId", "academicYearId", COALESCE("termId", ''));
CREATE INDEX "student_discounts_tenantId_idx" ON "student_discounts" ("tenantId");
CREATE INDEX "student_discounts_tenantId_academicYearId_idx" ON "student_discounts" ("tenantId", "academicYearId");
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_discountId_fkey"
  FOREIGN KEY ("discountId") REFERENCES "discounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "fee_signups" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "feeTypeId" TEXT NOT NULL,
  "termId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_signups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fee_signups_tenantId_studentId_feeTypeId_termId_key" ON "fee_signups" ("tenantId", "studentId", "feeTypeId", "termId");
CREATE INDEX "fee_signups_tenantId_termId_idx" ON "fee_signups" ("tenantId", "termId");
ALTER TABLE "fee_signups" ADD CONSTRAINT "fee_signups_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_signups" ADD CONSTRAINT "fee_signups_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_signups" ADD CONSTRAINT "fee_signups_feeTypeId_fkey"
  FOREIGN KEY ("feeTypeId") REFERENCES "fee_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fee_signups" ADD CONSTRAINT "fee_signups_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['discounts', 'student_discounts', 'fee_signups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_setting('app.tenant_id', true))
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO educore_app', t);
  END LOOP;
END $$;
