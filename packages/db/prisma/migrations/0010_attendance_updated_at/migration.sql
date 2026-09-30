-- Milestone 2.1 (attendance): when a register entry was last changed, shown
-- on the register ("last saved by … at …"). Who changed what, before/after,
-- lives in the audit log. Existing rows take their creation time.
ALTER TABLE "attendance" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "attendance" SET "updatedAt" = "createdAt";
