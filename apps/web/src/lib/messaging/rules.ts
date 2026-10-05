/**
 * Announcements and messaging rules (Phase 4.4). Pure and unit-tested; the
 * data layer turns them into queries.
 *
 * Announcements
 * - SCHOOL: everyone at the school. ROLE: people with that role. CLASS: the
 *   class's teachers, its students and their parents.
 * - School admins see and manage every announcement. Teachers post only to
 *   classes they teach, and edit only their own. Pinning is for admins.
 *
 * Messages (teacher ↔ parent, about a child)
 * - A teacher can write to the parents of students in sections they teach.
 * - A parent can write to their child's teachers (form + subject teachers)
 *   and to the school's admins.
 * - A school admin can write to any student's parents, and can read every
 *   conversation (safeguarding) — replying adds them to it, visibly.
 * - Messages are never edited or deleted.
 */

export type MessagingRole = "SCHOOL_ADMIN" | "TEACHER" | "PARENT" | "STUDENT" | "ACCOUNTANT" | "PLATFORM_ADMIN";

export interface AnnouncementAudience {
  audienceScope: "SCHOOL" | "CLASS" | "ROLE";
  audienceClassId: string | null;
  audienceRole: string | null;
  publishedById: string;
}

export interface Viewer {
  userId: string;
  role: MessagingRole;
  /** Classes the viewer belongs to: teacher → classes taught, parent → children's, student → own. */
  classIds: readonly string[];
}

export function announcementVisibleTo(a: AnnouncementAudience, v: Viewer): boolean {
  if (v.role === "SCHOOL_ADMIN" || a.publishedById === v.userId) return true;
  if (a.audienceScope === "SCHOOL") return true;
  if (a.audienceScope === "ROLE") return a.audienceRole === v.role;
  return a.audienceClassId !== null && v.classIds.includes(a.audienceClassId) && (v.role === "TEACHER" || v.role === "PARENT" || v.role === "STUDENT");
}

export type PostRefusal = "notAllowed" | "classNotTaught" | "pinAdminOnly" | null;

export function canPostAnnouncement(
  poster: { role: MessagingRole; classIds: readonly string[] },
  a: { audienceScope: "SCHOOL" | "CLASS" | "ROLE"; audienceClassId: string | null; isPinned: boolean },
): PostRefusal {
  if (poster.role === "SCHOOL_ADMIN") return null;
  if (poster.role !== "TEACHER") return "notAllowed";
  if (a.isPinned) return "pinAdminOnly";
  if (a.audienceScope !== "CLASS" || !a.audienceClassId) return "classNotTaught";
  return poster.classIds.includes(a.audienceClassId) ? null : "classNotTaught";
}

export function canEditAnnouncement(editor: { role: MessagingRole; userId: string }, a: { publishedById: string }): boolean {
  return editor.role === "SCHOOL_ADMIN" || (editor.role === "TEACHER" && a.publishedById === editor.userId);
}

/** Who may start conversations at all. */
export function canMessage(role: MessagingRole): boolean {
  return role === "SCHOOL_ADMIN" || role === "TEACHER" || role === "PARENT";
}

/** A thread is unread for a participant when something arrived after they last read it. */
export function isUnread(lastMessageAt: Date, lastReadAt: Date | null): boolean {
  return lastReadAt === null || lastMessageAt > lastReadAt;
}

/** May this person open the thread? Participants, and school admins (safeguarding). */
export function canReadThread(v: { role: MessagingRole; userId: string }, participantIds: readonly string[]): boolean {
  return v.role === "SCHOOL_ADMIN" || participantIds.includes(v.userId);
}
