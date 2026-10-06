-- Phase 5.3: an assignment can count towards a score component (e.g. CA1). Additive.
ALTER TABLE "assignments" ADD COLUMN "assessmentTypeId" TEXT;
ALTER TABLE "assignments" ADD COLUMN "caSentAt" TIMESTAMP(3);
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assessmentTypeId_fkey" FOREIGN KEY ("assessmentTypeId") REFERENCES "assessment_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Only scored work can count towards CA.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_ca_scored" CHECK ("assessmentTypeId" IS NULL OR "maxScore" IS NOT NULL);
CREATE INDEX "assignments_tenantId_ca_idx" ON "assignments"("tenantId", "sectionId", "subjectId", "termId", "assessmentTypeId");
