-- Phase 4.4: announcements and teacher–parent messaging. Additive.

-- Announcements: pinning, edit time, and an audience that always makes sense.
ALTER TABLE "announcements"
  ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_audience" CHECK (
    (("audienceScope" = 'CLASS') = ("audienceClassId" IS NOT NULL)) AND
    (("audienceScope" = 'ROLE') = ("audienceRole" IS NOT NULL))
  ),
  ADD CONSTRAINT "announcements_lengths" CHECK (char_length("title") BETWEEN 1 AND 150 AND char_length("body") BETWEEN 1 AND 5000),
  ADD CONSTRAINT "announcements_audienceClassId_fkey" FOREIGN KEY ("audienceClassId") REFERENCES "class_grades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "announcements_tenantId_isPinned_publishedAt_idx" ON "announcements"("tenantId", "isPinned", "publishedAt");

-- Threads: who started it, and when it last moved (sorting, unread).
ALTER TABLE "message_threads"
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "message_threads_subject" CHECK (char_length("subject") BETWEEN 1 AND 150),
  ADD CONSTRAINT "message_threads_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "message_threads_tenantId_lastMessageAt_idx" ON "message_threads"("tenantId", "lastMessageAt");

-- Participants: read position for unread counts.
ALTER TABLE "thread_participants"
  ADD COLUMN "lastReadAt" TIMESTAMP(3),
  ADD COLUMN "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "thread_participants_userId_idx" ON "thread_participants"("userId");

-- Messages are a permanent record (safeguarding): never edited or deleted by the app.
ALTER TABLE "messages" ADD CONSTRAINT "messages_body" CHECK (char_length("body") BETWEEN 1 AND 5000);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE UPDATE, DELETE ON "messages" FROM educore_app;
  END IF;
END $$;
