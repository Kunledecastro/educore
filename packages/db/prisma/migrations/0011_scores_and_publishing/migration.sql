-- Phase 2, milestone 2.2: scores and results publishing.
--   * assessments belong to a term (one gradebook column per component,
--     subject, section and term); a term with assessments can't be deleted
--   * sanity CHECKs on maxScore and scores
--   * result_publications: a class's term results are visible to families
--     only while published (tenant-owned, forced RLS)

ALTER TABLE "assessments" ADD COLUMN "termId" TEXT;

-- Backfill: the term of the same academic year whose dates contain the
-- assessment date; otherwise that year's first term.
UPDATE "assessments" a SET "termId" = t.id
FROM "terms" t
WHERE t."tenantId" = a."tenantId" AND t."academicYearId" = a."academicYearId"
  AND a."date" BETWEEN t."startDate" AND t."endDate" AND a."termId" IS NULL;
UPDATE "assessments" a SET "termId" = (
  SELECT t.id FROM "terms" t
  WHERE t."tenantId" = a."tenantId" AND t."academicYearId" = a."academicYearId"
  ORDER BY t."order" LIMIT 1)
WHERE a."termId" IS NULL;

ALTER TABLE "assessments" ALTER COLUMN "termId" SET NOT NULL;
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "assessments_tenantId_termId_sectionId_subjectId_assessmentTypeId_key"
  ON "assessments" ("tenantId", "termId", "sectionId", "subjectId", "assessmentTypeId");
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_max_score_check" CHECK ("maxScore" > 0);
ALTER TABLE "marks" ADD CONSTRAINT "marks_score_check" CHECK ("score" >= 0);

CREATE TABLE "result_publications" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "termId"        TEXT NOT NULL,
  "classId"       TEXT NOT NULL,
  "publishedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedById" TEXT,
  CONSTRAINT "result_publications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "result_publications_tenantId_termId_classId_key" ON "result_publications" ("tenantId", "termId", "classId");
CREATE INDEX "result_publications_tenantId_idx" ON "result_publications" ("tenantId");
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "class_grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_publishedById_fkey"
  FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "result_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "result_publications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "result_publications"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "result_publications" TO educore_app;
