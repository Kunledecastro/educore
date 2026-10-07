-- Phase 7.2: the clinic visit log, and when a pupil left (for health retention). Additive.

-- When a pupil stopped being active (withdrawn, graduated, inactive). Kept up
-- to date by a trigger so every way of changing status counts; cleared if
-- they come back. Existing non-active pupils are backfilled from updatedAt.
ALTER TABLE "students" ADD COLUMN "leftAt" TIMESTAMP(3);
UPDATE "students" SET "leftAt" = "updatedAt" WHERE "status" <> 'ACTIVE' AND "leftAt" IS NULL;
CREATE OR REPLACE FUNCTION students_track_left_at() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'ACTIVE' THEN
    NEW."leftAt" := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD."status" = 'ACTIVE' OR NEW."leftAt" IS NULL THEN
    NEW."leftAt" := COALESCE(CASE WHEN TG_OP = 'UPDATE' AND OLD."status" <> 'ACTIVE' THEN OLD."leftAt" END, CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER students_left_at BEFORE INSERT OR UPDATE OF "status" ON "students" FOR EACH ROW EXECUTE FUNCTION students_track_left_at();

-- One clinic visit. What reports count (complaint, outcome, medicines, class,
-- time) is stored plainly; the clinical details are one encrypted JSON
-- document. After the school's retention period the visit is anonymised:
-- studentId and the details are cleared, the counts stay.
CREATE TABLE "clinic_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT,
    "classLabel" TEXT NOT NULL DEFAULT '',
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "complaint" TEXT NOT NULL,
    "outcome" TEXT,
    "medicines" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "detailEnc" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clinic_visits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clinic_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clinic_visits_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "clinic_visits_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "clinic_visits_complaint" CHECK ("complaint" IN ('HEADACHE', 'FEVER', 'STOMACH_ACHE', 'VOMITING', 'DIARRHOEA', 'COLD_FLU', 'INJURY', 'ASTHMA', 'SICKLE_CELL_CRISIS', 'ALLERGIC_REACTION', 'MENSTRUAL', 'TOOTHACHE', 'EYE', 'SKIN', 'DIZZINESS', 'OTHER')),
    CONSTRAINT "clinic_visits_outcome" CHECK ("outcome" IS NULL OR "outcome" IN ('BACK_TO_CLASS', 'RESTED', 'SENT_HOME', 'REFERRED')),
    CONSTRAINT "clinic_visits_medicines" CHECK ("medicines" <@ ARRAY['paracetamol','ibuprofen','antacid','ors','antihistamine','antiseptic','own']::TEXT[]),
    CONSTRAINT "clinic_visits_enc" CHECK ("detailEnc" IS NULL OR ("detailEnc" LIKE 'v1.%' AND char_length("detailEnc") <= 20000)),
    CONSTRAINT "clinic_visits_times" CHECK ("leftAt" IS NULL OR "leftAt" >= "arrivedAt"),
    CONSTRAINT "clinic_visits_anonymised" CHECK ("studentId" IS NOT NULL OR "detailEnc" IS NULL),
    CONSTRAINT "clinic_visits_class" CHECK (char_length("classLabel") <= 80)
);
CREATE INDEX "clinic_visits_tenantId_arrivedAt_idx" ON "clinic_visits"("tenantId", "arrivedAt");
CREATE INDEX "clinic_visits_tenantId_studentId_idx" ON "clinic_visits"("tenantId", "studentId");

ALTER TABLE "clinic_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinic_visits" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE ALL ON "clinic_visits" FROM educore_app;
  END IF;
END $$;
