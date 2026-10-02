-- Phase 2, milestone 2.3: report cards.
--   * report_cards point at a term (was free text), carry the two comments
--     and a frozen `snapshot` of the card's contents (the PDF is drawn from it)
--   * report_card_runs: one background generation per section + term, with progress

ALTER TABLE "report_cards" ADD COLUMN "termId" TEXT;
-- Map any existing rows by term name within their year; anything unmatched
-- makes the NOT NULL below fail loudly rather than losing a card silently.
UPDATE "report_cards" r SET "termId" = t.id FROM "terms" t
WHERE t."tenantId" = r."tenantId" AND t."academicYearId" = r."academicYearId" AND t.name = r."term";
ALTER TABLE "report_cards" ALTER COLUMN "termId" SET NOT NULL;
-- The old free-text "term" column is kept (nothing is dropped) but no longer
-- required or written; its old unique index is harmless with NULLs.
ALTER TABLE "report_cards" ALTER COLUMN "term" DROP NOT NULL;
ALTER TABLE "report_cards" ADD COLUMN "teacherComment" TEXT;
ALTER TABLE "report_cards" ADD COLUMN "principalComment" TEXT;
ALTER TABLE "report_cards" ADD COLUMN "snapshot" JSONB;
ALTER TABLE "report_cards" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "report_cards_tenantId_studentId_termId_key" ON "report_cards" ("tenantId", "studentId", "termId");
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_comment_length_check"
  CHECK (char_length(coalesce("teacherComment", '')) <= 600 AND char_length(coalesce("principalComment", '')) <= 600);

CREATE TYPE "ReportCardRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TABLE "report_card_runs" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "termId"      TEXT NOT NULL,
  "sectionId"   TEXT NOT NULL,
  "status"      "ReportCardRunStatus" NOT NULL DEFAULT 'QUEUED',
  "total"       INTEGER NOT NULL DEFAULT 0,
  "done"        INTEGER NOT NULL DEFAULT 0,
  "error"       TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"  TIMESTAMP(3),
  CONSTRAINT "report_card_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_card_runs_tenantId_idx" ON "report_card_runs" ("tenantId");
CREATE INDEX "report_card_runs_tenantId_termId_sectionId_createdAt_idx" ON "report_card_runs" ("tenantId", "termId", "sectionId", "createdAt");
ALTER TABLE "report_card_runs" ADD CONSTRAINT "report_card_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_card_runs" ADD CONSTRAINT "report_card_runs_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_card_runs" ADD CONSTRAINT "report_card_runs_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_card_runs" ADD CONSTRAINT "report_card_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_card_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_card_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "report_card_runs"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "report_card_runs" TO educore_app;
