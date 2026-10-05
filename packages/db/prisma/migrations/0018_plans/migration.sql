-- Phase 4.1: plan catalogue (platform-level). Prices are per active student
-- per month in minor units (kobo). Editable by platform admins only; schools
-- read their own plan through the server, never directly.
CREATE TABLE "plans" (
    "code" "Plan" NOT NULL,
    "name" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "maxStudents" INTEGER,
    "modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "plans_price_nonneg" CHECK ("priceMinor" >= 0),
    CONSTRAINT "plans_max_positive" CHECK ("maxStudents" IS NULL OR "maxStudents" > 0),
    CONSTRAINT "plans_modules_known" CHECK ("modules" <@ ARRAY['attendance','assessments','reportCards','timetable','fees','onlinePayments','messaging']::TEXT[])
);

ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE ALL ON "plans" FROM educore_app;
  END IF;
END $$;

INSERT INTO "plans" ("code", "name", "priceMinor", "maxStudents", "modules", "isPublic") VALUES
  ('FREE_TRIAL', 'Free trial', 0, 500, ARRAY['attendance','assessments','reportCards','timetable','fees','onlinePayments','messaging'], false),
  ('STARTER', 'Starter', 30000, 300, ARRAY['attendance','assessments','timetable','messaging'], true),
  ('STANDARD', 'Standard', 50000, 1500, ARRAY['attendance','assessments','reportCards','timetable','fees','messaging'], true),
  ('PREMIUM', 'Premium', 80000, NULL, ARRAY['attendance','assessments','reportCards','timetable','fees','onlinePayments','messaging'], true)
ON CONFLICT ("code") DO NOTHING;
