-- Phase 5.1/5.2: assignments, attachments and submissions. Additive.

CREATE TYPE "AssignmentMode" AS ENUM ('ONLINE', 'PAPER');
CREATE TYPE "AssignmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'RETURNED', 'MARKED');

CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT,
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "maxScore" DECIMAL(6,2),
    "mode" "AssignmentMode" NOT NULL DEFAULT 'ONLINE',
    "status" "AssignmentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "marksReleasedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignments_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignments_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "assignments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignments_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "assignments_title" CHECK (char_length("title") BETWEEN 1 AND 150),
    CONSTRAINT "assignments_instructions" CHECK (char_length("instructions") <= 10000),
    CONSTRAINT "assignments_max_score" CHECK ("maxScore" IS NULL OR ("maxScore" > 0 AND "maxScore" <= 1000)),
    CONSTRAINT "assignments_published" CHECK (("status" = 'DRAFT') = ("publishedAt" IS NULL)),
    CONSTRAINT "assignments_closed" CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL))
);
CREATE INDEX "assignments_tenantId_idx" ON "assignments"("tenantId");
CREATE INDEX "assignments_tenantId_sectionId_dueAt_idx" ON "assignments"("tenantId", "sectionId", "dueAt");
CREATE INDEX "assignments_tenantId_status_dueAt_idx" ON "assignments"("tenantId", "status", "dueAt");

CREATE TABLE "assignment_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "submittedById" TEXT,
    "score" DECIMAL(6,2),
    "feedback" TEXT,
    "markedAt" TIMESTAMP(3),
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignment_submissions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignment_submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignment_submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "assignment_submissions_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "assignment_submissions_text" CHECK (char_length("text") <= 10000),
    CONSTRAINT "assignment_submissions_feedback" CHECK ("feedback" IS NULL OR char_length("feedback") <= 2000),
    CONSTRAINT "assignment_submissions_score" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 1000)),
    CONSTRAINT "assignment_submissions_marked" CHECK (("status" = 'MARKED') = ("markedAt" IS NOT NULL))
);
-- One submission per student per assignment (resubmitting updates it).
CREATE UNIQUE INDEX "assignment_submissions_assignmentId_studentId_key" ON "assignment_submissions"("assignmentId", "studentId");
CREATE INDEX "assignment_submissions_tenantId_idx" ON "assignment_submissions"("tenantId");
CREATE INDEX "assignment_submissions_tenantId_studentId_idx" ON "assignment_submissions"("tenantId", "studentId");

-- Files: a teacher's worksheet (submissionId NULL) or part of a submission.
CREATE TABLE "assignment_files" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "submissionId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assignment_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignment_files_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignment_files_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assignment_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- Every object lives under its own school's folder in the bucket.
    CONSTRAINT "assignment_files_key" CHECK ("storageKey" LIKE "tenantId" || '/%' AND char_length("storageKey") <= 300),
    CONSTRAINT "assignment_files_name" CHECK (char_length("fileName") BETWEEN 1 AND 200),
    CONSTRAINT "assignment_files_type" CHECK ("contentType" IN ('application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
    CONSTRAINT "assignment_files_size" CHECK ("sizeBytes" BETWEEN 1 AND 10485760)
);
CREATE UNIQUE INDEX "assignment_files_storageKey_key" ON "assignment_files"("storageKey");
CREATE INDEX "assignment_files_tenantId_idx" ON "assignment_files"("tenantId");
CREATE INDEX "assignment_files_assignmentId_idx" ON "assignment_files"("assignmentId");
CREATE INDEX "assignment_files_submissionId_idx" ON "assignment_files"("submissionId");

ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assignments"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "assignment_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_submissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assignment_submissions"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "assignment_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assignment_files"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "assignments" TO educore_app;
    -- Handed-in work is a record: updated (resubmit, marking) but never deleted by the app.
    GRANT SELECT, INSERT, UPDATE ON "assignment_submissions" TO educore_app;
    REVOKE DELETE ON "assignment_submissions" FROM educore_app;
    GRANT SELECT, INSERT, DELETE ON "assignment_files" TO educore_app;
    REVOKE UPDATE ON "assignment_files" FROM educore_app;
  END IF;
END $$;

-- The plan catalogue gains an "assignments" module (Free trial, Standard, Premium).
ALTER TABLE "plans" DROP CONSTRAINT "plans_modules_known";
ALTER TABLE "plans" ADD CONSTRAINT "plans_modules_known" CHECK ("modules" <@ ARRAY['attendance','assessments','reportCards','timetable','fees','onlinePayments','messaging','assignments']::TEXT[]);
UPDATE "plans" SET "modules" = array_append("modules", 'assignments') WHERE "code" IN ('FREE_TRIAL', 'STANDARD', 'PREMIUM') AND NOT ('assignments' = ANY ("modules"));
