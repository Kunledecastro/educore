import { recordAudit, withRls, type Prisma, type PrismaClient } from "@educore/db";
import { announcementVisibleTo, canEditAnnouncement, canMessage, canPostAnnouncement, canReadThread, isUnread, type MessagingRole, type PostRefusal, type Viewer } from "./rules";

/**
 * Announcements and teacher–parent messaging (Phase 4.4): the database side.
 * Every function runs inside the school's RLS transaction (withRls) and also
 * filters by tenantId, so a school only ever touches its own rows; the rules
 * in rules.ts decide who may see or do what. No request APIs here.
 */

type Tx = PrismaClient;

export class MessagingError extends Error {
  constructor(public readonly code: NonNullable<PostRefusal> | "notFound" | "noRecipients" | "recipientNotAllowed" | "notAllowed") {
    super(code);
    this.name = "MessagingError";
  }
}

export interface AuditMeta {
  ipAddress: string | null;
  userAgent: string | null;
  impersonatorId?: string | null;
}

export interface FullViewer extends Viewer {
  tenantId: string;
  /** Teacher: sections they teach or are form teacher of. */
  sectionIds: string[];
  /** Parent: their children. Student: themself. */
  studentIds: string[];
}

/** Works out which classes, sections and children a person belongs to. */
export async function viewerFor(tenantId: string, user: { id: string; role: MessagingRole }): Promise<FullViewer> {
  return withRls(tenantId, async (tx) => {
    const base = { tenantId, userId: user.id, role: user.role };
    if (user.role === "TEACHER") {
      const t = await tx.teacher.findFirst({
        where: { tenantId, userId: user.id },
        select: { classSectionSubjects: { select: { section: { select: { id: true, classId: true } } } }, formSections: { select: { id: true, classId: true } } },
      });
      const sections = [...(t?.classSectionSubjects.map((c) => c.section) ?? []), ...(t?.formSections ?? [])];
      return { ...base, sectionIds: [...new Set(sections.map((s) => s.id))], classIds: [...new Set(sections.map((s) => s.classId))], studentIds: [] };
    }
    if (user.role === "PARENT") {
      const g = await tx.guardian.findFirst({ where: { tenantId, userId: user.id }, select: { students: { select: { student: { select: { id: true, classId: true } } } } } });
      const kids = g?.students.map((s) => s.student) ?? [];
      return { ...base, sectionIds: [], studentIds: kids.map((k) => k.id), classIds: [...new Set(kids.map((k) => k.classId).filter((c): c is string => Boolean(c)))] };
    }
    if (user.role === "STUDENT") {
      const s = await tx.student.findFirst({ where: { tenantId, userId: user.id }, select: { id: true, classId: true } });
      return { ...base, sectionIds: [], studentIds: s ? [s.id] : [], classIds: s?.classId ? [s.classId] : [] };
    }
    return { ...base, sectionIds: [], studentIds: [], classIds: [] };
  });
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

/** The database form of announcementVisibleTo(). */
export function announcementWhere(v: Viewer): Prisma.AnnouncementWhereInput {
  if (v.role === "SCHOOL_ADMIN") return {};
  const or: Prisma.AnnouncementWhereInput[] = [
    { publishedById: v.userId },
    { audienceScope: "SCHOOL" },
    { audienceScope: "ROLE", audienceRole: v.role as never },
  ];
  if ((v.role === "TEACHER" || v.role === "PARENT" || v.role === "STUDENT") && v.classIds.length) {
    or.push({ audienceScope: "CLASS", audienceClassId: { in: [...v.classIds] } });
  }
  return { OR: or };
}

export async function listAnnouncements(v: FullViewer, opts: { skip?: number; take?: number } = {}) {
  return withRls(v.tenantId, async (tx) => {
    const where = { tenantId: v.tenantId, ...announcementWhere(v) };
    const [rows, total] = await Promise.all([
      tx.announcement.findMany({
        where,
        orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
        skip: opts.skip ?? 0,
        take: opts.take ?? 20,
        include: { publishedBy: { select: { name: true } }, audienceClass: { select: { name: true } } },
      }),
      tx.announcement.count({ where }),
    ]);
    return { rows: rows.map((r) => ({ ...r, canEdit: canEditAnnouncement(v, r) })), total };
  });
}

export interface AnnouncementInput {
  title: string;
  body: string;
  audienceScope: "SCHOOL" | "CLASS" | "ROLE";
  audienceClassId: string | null;
  audienceRole: "SCHOOL_ADMIN" | "TEACHER" | "PARENT" | "STUDENT" | "ACCOUNTANT" | null;
  isPinned: boolean;
}

function normalise(a: AnnouncementInput): AnnouncementInput {
  return {
    ...a,
    audienceClassId: a.audienceScope === "CLASS" ? a.audienceClassId : null,
    audienceRole: a.audienceScope === "ROLE" ? a.audienceRole : null,
  };
}

async function assertClass(tx: Tx, tenantId: string, a: AnnouncementInput) {
  if (a.audienceScope === "CLASS") {
    const cls = a.audienceClassId ? await tx.classGrade.findFirst({ where: { id: a.audienceClassId, tenantId }, select: { id: true } }) : null;
    if (!cls) throw new MessagingError("notFound");
  }
}

export async function createAnnouncement(v: FullViewer, input: AnnouncementInput, meta: AuditMeta) {
  const a = normalise(input);
  const refusal = canPostAnnouncement(v, a);
  if (refusal) throw new MessagingError(refusal);
  return withRls(v.tenantId, async (tx) => {
    await assertClass(tx, v.tenantId, a);
    const after = await tx.announcement.create({ data: { tenantId: v.tenantId, publishedById: v.userId, ...a } });
    await recordAudit({ tenantId: v.tenantId, actorId: v.userId, ...meta }, { action: "CREATE", entityType: "Announcement", entityId: after.id, after }, tx);
    return after;
  });
}

export async function updateAnnouncement(v: FullViewer, id: string, input: AnnouncementInput, meta: AuditMeta) {
  const a = normalise(input);
  return withRls(v.tenantId, async (tx) => {
    const before = await tx.announcement.findFirst({ where: { id, tenantId: v.tenantId } });
    if (!before || !announcementVisibleTo(before, v)) throw new MessagingError("notFound");
    if (!canEditAnnouncement(v, before)) throw new MessagingError("notAllowed");
    const refusal = canPostAnnouncement(v, a);
    if (refusal) throw new MessagingError(refusal);
    await assertClass(tx, v.tenantId, a);
    const after = await tx.announcement.update({ where: { id }, data: a });
    await recordAudit({ tenantId: v.tenantId, actorId: v.userId, ...meta }, { action: "UPDATE", entityType: "Announcement", entityId: id, before, after }, tx);
    return after;
  });
}

/** School admins only (teachers can edit their own, not delete). */
export async function deleteAnnouncement(v: FullViewer, id: string, meta: AuditMeta) {
  if (v.role !== "SCHOOL_ADMIN") throw new MessagingError("notAllowed");
  await withRls(v.tenantId, async (tx) => {
    const before = await tx.announcement.findFirst({ where: { id, tenantId: v.tenantId } });
    if (!before) throw new MessagingError("notFound");
    await tx.announcement.delete({ where: { id } });
    await recordAudit({ tenantId: v.tenantId, actorId: v.userId, ...meta }, { action: "DELETE", entityType: "Announcement", entityId: id, before }, tx);
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface Recipient {
  userId: string;
  name: string;
  /** "PARENT", "FORM_TEACHER", "TEACHER", "SCHOOL_ADMIN" — for labels. */
  kind: string;
  /** Subjects taught (teachers). */
  detail: string | null;
}

/** Students this person may start a conversation about (search by name or admission number). */
export async function messageableStudents(v: FullViewer, q = "", take = 30) {
  if (!canMessage(v.role)) return [];
  return withRls(v.tenantId, async (tx) => {
    const scope: Prisma.StudentWhereInput =
      v.role === "PARENT" ? { id: { in: v.studentIds } } : v.role === "TEACHER" ? { sectionId: { in: v.sectionIds } } : {};
    const search = q.trim().slice(0, 60);
    return tx.student.findMany({
      where: {
        tenantId: v.tenantId,
        status: "ACTIVE",
        ...scope,
        ...(search ? { OR: [{ firstName: { contains: search, mode: "insensitive" } }, { lastName: { contains: search, mode: "insensitive" } }, { admissionNo: { contains: search, mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take,
      select: { id: true, firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } }, section: { select: { name: true } } },
    });
  });
}

/** Who this person may write to about one student. Empty when they may not write about them at all. */
export async function recipientsFor(v: FullViewer, studentId: string, tx?: Tx): Promise<Recipient[]> {
  if (!canMessage(v.role)) return [];
  const run = async (t: Tx): Promise<Recipient[]> => {
    const student = await t.student.findFirst({
      where: { id: studentId, tenantId: v.tenantId },
      select: {
        id: true,
        sectionId: true,
        guardians: { select: { guardian: { select: { user: { select: { id: true, name: true, isActive: true } } } } } },
        section: {
          select: {
            formTeacher: { select: { user: { select: { id: true, name: true, isActive: true } } } },
            classSectionSubjects: { select: { subject: { select: { name: true } }, teacher: { select: { user: { select: { id: true, name: true, isActive: true } } } } } },
          },
        },
      },
    });
    if (!student) return [];
    const parents = (): Recipient[] =>
      student.guardians.map((g) => g.guardian.user).filter((u) => u.isActive && u.id !== v.userId).map((u) => ({ userId: u.id, name: u.name ?? "", kind: "PARENT", detail: null }));

    if (v.role === "SCHOOL_ADMIN") return parents();
    if (v.role === "TEACHER") return student.sectionId && v.sectionIds.includes(student.sectionId) ? parents() : [];
    // Parent → this child's teachers and the school's admins.
    if (!v.studentIds.includes(student.id)) return [];
    const out = new Map<string, Recipient>();
    const form = student.section?.formTeacher?.user;
    if (form?.isActive) out.set(form.id, { userId: form.id, name: form.name ?? "", kind: "FORM_TEACHER", detail: null });
    for (const css of student.section?.classSectionSubjects ?? []) {
      const u = css.teacher.user;
      if (!u.isActive) continue;
      const existing = out.get(u.id);
      if (existing) existing.detail = [existing.detail, css.subject.name].filter(Boolean).join(", ");
      else out.set(u.id, { userId: u.id, name: u.name ?? "", kind: "TEACHER", detail: css.subject.name });
    }
    const admins = await t.user.findMany({ where: { tenantId: v.tenantId, role: "SCHOOL_ADMIN", isActive: true }, select: { id: true, name: true } });
    for (const a of admins) if (!out.has(a.id)) out.set(a.id, { userId: a.id, name: a.name ?? "", kind: "SCHOOL_ADMIN", detail: null });
    return [...out.values()];
  };
  return tx ? run(tx) : withRls(v.tenantId, run);
}

export interface NewThread {
  studentId: string;
  recipientIds: string[];
  subject: string;
  body: string;
}

/** Starts a conversation about a student. Returns the thread and who should be notified. */
export async function startThread(v: FullViewer, input: NewThread, meta: AuditMeta, now: Date = new Date()) {
  if (!canMessage(v.role)) throw new MessagingError("notAllowed");
  const wanted = [...new Set(input.recipientIds)].filter((id) => id !== v.userId);
  if (wanted.length === 0) throw new MessagingError("noRecipients");
  return withRls(v.tenantId, async (tx) => {
    const allowed = new Set((await recipientsFor(v, input.studentId, tx)).map((r) => r.userId));
    if (allowed.size === 0) throw new MessagingError("notFound");
    if (!wanted.every((id) => allowed.has(id))) throw new MessagingError("recipientNotAllowed");

    const thread = await tx.messageThread.create({
      data: {
        tenantId: v.tenantId,
        subject: input.subject,
        studentId: input.studentId,
        createdById: v.userId,
        lastMessageAt: now,
        participants: { create: [{ userId: v.userId, lastReadAt: now, joinedAt: now }, ...wanted.map((userId) => ({ userId, joinedAt: now }))] },
      },
    });
    const message = await tx.message.create({ data: { tenantId: v.tenantId, threadId: thread.id, senderId: v.userId, body: input.body, sentAt: now } });
    await recordAudit(
      { tenantId: v.tenantId, actorId: v.userId, ...meta },
      { action: "CREATE", entityType: "MessageThread", entityId: thread.id, after: { subject: thread.subject, studentId: thread.studentId, participants: [v.userId, ...wanted] } },
      tx,
    );
    return { threadId: thread.id, messageId: message.id, notify: wanted };
  });
}

/**
 * Replies in a conversation. Participants can reply; a school admin who
 * isn't one joins it by replying (everyone sees they joined).
 */
export async function reply(v: FullViewer, threadId: string, body: string, meta: AuditMeta, now: Date = new Date()) {
  if (!canMessage(v.role)) throw new MessagingError("notAllowed");
  return withRls(v.tenantId, async (tx) => {
    await tx.$queryRaw`SELECT id FROM message_threads WHERE id = ${threadId} FOR UPDATE`;
    const thread = await tx.messageThread.findFirst({ where: { id: threadId, tenantId: v.tenantId }, include: { participants: { select: { userId: true } } } });
    const ids = thread?.participants.map((p) => p.userId) ?? [];
    if (!thread || !canReadThread(v, ids)) throw new MessagingError("notFound");
    if (!ids.includes(v.userId)) {
      await tx.threadParticipant.create({ data: { threadId, userId: v.userId, joinedAt: now } });
      await recordAudit({ tenantId: v.tenantId, actorId: v.userId, ...meta }, { action: "UPDATE", entityType: "MessageThread", entityId: threadId, after: { joined: v.userId } }, tx);
    }
    const message = await tx.message.create({ data: { tenantId: v.tenantId, threadId, senderId: v.userId, body, sentAt: now } });
    await tx.messageThread.update({ where: { id: threadId }, data: { lastMessageAt: now } });
    await tx.threadParticipant.updateMany({ where: { threadId, userId: v.userId }, data: { lastReadAt: now } });
    return { messageId: message.id, notify: ids.filter((id) => id !== v.userId) };
  });
}

/** Conversations for the list: the person's own, or (school admins) every one in the school. */
export async function listThreads(v: FullViewer, opts: { all?: boolean; skip?: number; take?: number } = {}) {
  return withRls(v.tenantId, async (tx) => {
    const all = Boolean(opts.all) && v.role === "SCHOOL_ADMIN";
    const where: Prisma.MessageThreadWhereInput = { tenantId: v.tenantId, ...(all ? {} : { participants: { some: { userId: v.userId } } }) };
    const [rows, total] = await Promise.all([
      tx.messageThread.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        skip: opts.skip ?? 0,
        take: opts.take ?? 25,
        include: {
          student: { select: { firstName: true, lastName: true } },
          participants: { select: { userId: true, lastReadAt: true, user: { select: { name: true, role: true } } } },
          messages: { orderBy: { sentAt: "desc" }, take: 1, select: { body: true, sender: { select: { name: true } } } },
        },
      }),
      tx.messageThread.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((t) => {
        const me = t.participants.find((p) => p.userId === v.userId);
        return {
          id: t.id,
          subject: t.subject,
          student: t.student ? `${t.student.firstName} ${t.student.lastName}` : null,
          lastMessageAt: t.lastMessageAt,
          others: t.participants.filter((p) => p.userId !== v.userId).map((p) => p.user.name ?? ""),
          last: t.messages[0] ? { body: t.messages[0].body.slice(0, 140), sender: t.messages[0].sender.name ?? "" } : null,
          unread: me ? isUnread(t.lastMessageAt, me.lastReadAt) : false,
          participating: Boolean(me),
        };
      }),
    };
  });
}

/** One conversation, oldest message first. Opening it marks it read for a participant. Null if not allowed. */
export async function openThread(v: FullViewer, threadId: string, now: Date = new Date()) {
  return withRls(v.tenantId, async (tx) => {
    const thread = await tx.messageThread.findFirst({
      where: { id: threadId, tenantId: v.tenantId },
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        participants: { select: { userId: true, user: { select: { name: true, role: true } } } },
        messages: { orderBy: { sentAt: "asc" }, take: 300, select: { id: true, body: true, sentAt: true, senderId: true, sender: { select: { name: true, role: true } } } },
      },
    });
    if (!thread || !canReadThread(v, thread.participants.map((p) => p.userId))) return null;
    const participating = thread.participants.some((p) => p.userId === v.userId);
    if (participating) await tx.threadParticipant.updateMany({ where: { threadId, userId: v.userId }, data: { lastReadAt: now } });
    return { ...thread, participating };
  });
}

/** How many of this person's conversations have something new. */
export async function unreadThreadCount(tenantId: string, userId: string): Promise<number> {
  return withRls(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM thread_participants p
      JOIN message_threads t ON t.id = p."threadId"
      WHERE p."userId" = ${userId} AND t."tenantId" = ${tenantId}
        AND (p."lastReadAt" IS NULL OR t."lastMessageAt" > p."lastReadAt")`;
    return Number(rows[0]?.n ?? 0);
  });
}
