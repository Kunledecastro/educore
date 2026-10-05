-- Phase 5.0: student logins. Additive.
-- Students sign in with their school's short name + admission number, stored
-- as a username "<school-short-name>:<admission-no>" (lower case). Their
-- email column holds an internal, never-emailed address (*.invalid).
ALTER TABLE "users"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK ("username" IS NULL OR "username" ~ '^[a-z0-9-]{3,30}:[a-z0-9/_.-]{1,40}$');

-- Parents' consent to their child having a login (recorded by staff).
ALTER TABLE "students"
  ADD COLUMN "parentConsentAt" TIMESTAMP(3),
  ADD COLUMN "parentConsentById" TEXT,
  ADD CONSTRAINT "students_parentConsentById_fkey" FOREIGN KEY ("parentConsentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
