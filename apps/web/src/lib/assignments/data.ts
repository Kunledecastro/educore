import { randomBytes } from "node:crypto";
import { Prisma, recordAudit, withRls, type PrismaClient } from "@educore/db";
import { MAX_FILE_BYTES, MAX_FILES_PER_ASSIGNMENT, objectKey, readGrant, safeFileName, signGrant, sniffType, typeMatches, type AllowedType, type UploadGrant } from "../storage/files";
import { objectStore, scanUpload, type ObjectStore } from "../storage/object-store";
import { canDelete, canHandIn, canManage, canSee, type AnyRole, type TeachingPair } from "./rules";

/**
 * Assignments, database side (Phase 5.1). Everything runs in the school's
 * RLS transaction and filters by tenantId; who may do what comes from
 * rules.ts. Files live in private storage; only their metadata is here.
 */

export type Tx = PrismaClient;

export class AssignmentError extends Error {
  constructor(
    public readonly code:
      | "notFound"
      | "notAllowed"
      | "hasWork"
      | "storageOff"
      | "badFile"
      | "tooLarge"
      | "tooManyFiles"
      | "uploadMissing"
      | "notDraft"
      | "badDue"
      | "modeLocked"
      | "scoreBelowMarks"
      | "invalidState"
      | "quotaFull"
      | "cannotHandIn"
      | "alreadyMarked"
      | "emptyWork"
      | "badScore"
      | "notYetDue"
      | "feedbackNeeded",
  ) {
    super(code);
    this.name = "AssignmentError";
  }
}

export interface Meta {
  ipAddress: string | null;
  userAgent: string | null;
  impersonatorId?: string | null;
}

export interface AssignmentViewer {
  tenantId: string;
  userId: string;
  role: AnyRole;
  /** Teachers: (section, subject) pairs they teach. */
  pairs: TeachingPair[];
  /** Teachers: sections taught + form sections. Students/parents: the student's (children's) sections. */
  sectionIds: string[];
  /** Students: themself. Parents: their children. */
  students: { id: string; name: string; sectionId: string | null }[];
}

export async function assignmentViewer(tenantId: string, user: { id: string; role: AnyRole }): Promise<AssignmentViewer> {
  return withRls(tenantId, async (tx) => {
    const base = { tenantId, userId: user.id, role: user.role, pairs: [] as TeachingPair[], sectionIds: [] as string[], students: [] as AssignmentViewer["students"] };
    if (user.role === "TEACHER") {
      const t = await tx.teacher.findFirst({ where: { tenantId, userId: user.id }, select: { classSectionSubjects: { select: { sectionId: true, subjectId: true } }, formSections: { select: { id: true } } } });
      const pairs = t?.classSectionSubjects ?? [];
      return { ...base, pairs, sectionIds: [...new Set([...pairs.map((p) => p.sectionId), ...(t?.formSections.map((s) => s.id) ?? [])])] };
    }
    if (user.role === "PARENT" || user.role === "STUDENT") {
      const kids =
        user.role === "PARENT"
          ? ((await tx.guardian.findFirst({ where: { tenantId, userId: user.id }, select: { students: { select: { student: { select: { id: true, firstName: true, lastName: true, sectionId: true, status: true } } } } } }))?.students.map((s) => s.student) ?? [])
          : await tx.student.findMany({ where: { tenantId, userId: user.id }, select: { id: true, firstName: true, lastName: true, sectionId: true, status: true } });
      const active = kids.filter((k) => k.status === "ACTIVE");
      return {
        ...base,
        students: active.map((k) => ({ id: k.id, name: `${k.firstName} ${k.lastName}`, sectionId: k.sectionId })),
        sectionIds: [...new Set(active.map((k) => k.sectionId).filter((s): s is string => Boolean(s)))],
      };
    }
    return base;
  });
}

export const audit = (v: AssignmentViewer, meta: Meta) => ({ tenantId: v.tenantId, actorId: v.userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent, impersonatorId: meta.impersonatorId ?? null });

export async function loadVisible(tx: Tx, v: AssignmentViewer, id: string) {
  const a = await tx.assignment.findFirst({ where: { id, tenantId: v.tenantId } });
  if (!a || !canSee(v, a)) throw new AssignmentError("notFound");
  return a;
}

export async function loadManageable(tx: Tx, v: AssignmentViewer, id: string) {
  const a = await loadVisible(tx, v, id);
  if (!canManage(v, a)) throw new AssignmentError("notAllowed");
  return a;
}

// ---------------------------------------------------------------------------
// Create / edit / publish / close / delete
// ---------------------------------------------------------------------------

export interface AssignmentInput {
  title: string;
  instructions: string;
  dueAt: Date;
  maxScore: number | null;
  mode: "ONLINE" | "PAPER";
}

/** Creates the same assignment for each chosen section (one per section), as drafts or published. */
export async function createAssignments(v: AssignmentViewer, input: AssignmentInput & { sectionIds: string[]; subjectId: string; publish: boolean }, meta: Meta, now: Date = new Date()) {
  const sectionIds = [...new Set(input.sectionIds)];
  for (const sectionId of sectionIds) if (!canManage(v, { sectionId, subjectId: input.subjectId })) throw new AssignmentError("notAllowed");
  if (input.dueAt.getTime() < now.getTime() - 60_000 && input.publish) throw new AssignmentError("badDue");
  return withRls(v.tenantId, async (tx) => {
    const [sections, subject] = await Promise.all([
      tx.section.findMany({ where: { tenantId: v.tenantId, id: { in: sectionIds } }, select: { id: true, class: { select: { academicYearId: true } } } }),
      tx.subject.findFirst({ where: { tenantId: v.tenantId, id: input.subjectId }, select: { id: true } }),
    ]);
    if (sections.length !== sectionIds.length || !subject) throw new AssignmentError("notFound");
    const ids: string[] = [];
    for (const s of sections) {
      const term = await tx.term.findFirst({ where: { tenantId: v.tenantId, academicYearId: s.class.academicYearId, startDate: { lte: input.dueAt }, endDate: { gte: input.dueAt } }, select: { id: true } });
      const created = await tx.assignment.create({
        data: {
          tenantId: v.tenantId,
          academicYearId: s.class.academicYearId,
          termId: term?.id ?? null,
          sectionId: s.id,
          subjectId: input.subjectId,
          title: input.title,
          instructions: input.instructions,
          dueAt: input.dueAt,
          maxScore: input.maxScore === null ? null : new Prisma.Decimal(input.maxScore),
          mode: input.mode,
          status: input.publish ? "PUBLISHED" : "DRAFT",
          publishedAt: input.publish ? now : null,
          createdById: v.userId,
        },
      });
      await recordAudit(audit(v, meta), { action: "CREATE", entityType: "Assignment", entityId: created.id, after: created }, tx);
      ids.push(created.id);
    }
    return ids;
  });
}

export async function updateAssignment(v: AssignmentViewer, id: string, input: AssignmentInput, meta: Meta) {
  await withRls(v.tenantId, async (tx) => {
    const before = await loadManageable(tx, v, id);
    const work = await tx.assignmentSubmission.aggregate({ where: { tenantId: v.tenantId, assignmentId: id }, _count: { _all: true }, _max: { score: true } });
    if (work._count._all > 0 && input.mode !== before.mode) throw new AssignmentError("modeLocked");
    const highest = work._max.score ? Number(work._max.score) : null;
    if (highest !== null && (input.maxScore === null || input.maxScore < highest)) throw new AssignmentError("scoreBelowMarks");
    const after = await tx.assignment.update({
      where: { id },
      data: { title: input.title, instructions: input.instructions, dueAt: input.dueAt, maxScore: input.maxScore === null ? null : new Prisma.Decimal(input.maxScore), mode: input.mode },
    });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "Assignment", entityId: id, before, after }, tx);
  });
}

export async function setAssignmentStatus(v: AssignmentViewer, id: string, to: "PUBLISHED" | "CLOSED", meta: Meta, now: Date = new Date()) {
  await withRls(v.tenantId, async (tx) => {
    const before = await loadManageable(tx, v, id);
    if (before.status === to) return;
    const data =
      to === "PUBLISHED"
        ? { status: "PUBLISHED" as const, publishedAt: before.publishedAt ?? now, closedAt: null }
        : before.status === "DRAFT"
          ? null
          : { status: "CLOSED" as const, closedAt: now };
    if (!data) throw new AssignmentError("invalidState"); // a draft can't be closed
    const after = await tx.assignment.update({ where: { id }, data });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "Assignment", entityId: id, before: { status: before.status }, after: { status: after.status } }, tx);
  });
}

/** Deletes an assignment nobody has handed anything in for. Returns storage keys to remove. */
export async function deleteAssignment(v: AssignmentViewer, id: string, meta: Meta, store: ObjectStore = objectStore) {
  const keys = await withRls(v.tenantId, async (tx) => {
    const before = await loadManageable(tx, v, id);
    const count = await tx.assignmentSubmission.count({ where: { tenantId: v.tenantId, assignmentId: id } });
    if (!canDelete(count)) throw new AssignmentError("hasWork");
    const files = await tx.assignmentFile.findMany({ where: { tenantId: v.tenantId, assignmentId: id }, select: { storageKey: true } });
    await tx.assignment.delete({ where: { id } });
    await recordAudit(audit(v, meta), { action: "DELETE", entityType: "Assignment", entityId: id, before }, tx);
    return files.map((f) => f.storageKey);
  });
  if (keys.length && store.configured()) await store.remove(keys).catch((err) => console.error("[assignments] could not remove files", err));
}

// ---------------------------------------------------------------------------
// Lists and detail
// ---------------------------------------------------------------------------

/** Staff list: admins see all; teachers the sections they teach or are form teacher of. */
export async function listForStaff(v: AssignmentViewer, opts: { sectionId?: string; status?: "DRAFT" | "PUBLISHED" | "CLOSED"; skip?: number; take?: number } = {}) {
  return withRls(v.tenantId, async (tx) => {
    const scope: Prisma.AssignmentWhereInput =
      v.role === "SCHOOL_ADMIN"
        ? {}
        : { sectionId: { in: v.sectionIds }, OR: [{ status: { not: "DRAFT" } }, ...v.pairs.map((p) => ({ sectionId: p.sectionId, subjectId: p.subjectId }))] };
    const where: Prisma.AssignmentWhereInput = {
      tenantId: v.tenantId,
      ...scope,
      ...(opts.sectionId ? { sectionId: opts.sectionId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      academicYear: { isActive: true },
    };
    const [rows, total] = await Promise.all([
      tx.assignment.findMany({
        where,
        orderBy: [{ dueAt: "desc" }],
        skip: opts.skip ?? 0,
        take: opts.take ?? 25,
        include: {
          section: { select: { name: true, class: { select: { name: true } }, _count: { select: { students: { where: { status: "ACTIVE" } } } } } },
          subject: { select: { name: true } },
          _count: { select: { submissions: true } },
        },
      }),
      tx.assignment.count({ where }),
    ]);
    const toMark = rows.length
      ? await tx.assignmentSubmission.groupBy({ by: ["assignmentId"], where: { tenantId: v.tenantId, assignmentId: { in: rows.map((r) => r.id) }, status: "SUBMITTED" }, _count: { _all: true } })
      : [];
    const pending = new Map(toMark.map((g) => [g.assignmentId, g._count._all]));
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        className: `${r.section.class.name} ${r.section.name}`,
        subject: r.subject.name,
        dueAt: r.dueAt,
        status: r.status,
        mode: r.mode,
        handedIn: r._count.submissions,
        classSize: r.section._count.students,
        toMark: pending.get(r.id) ?? 0,
        canManage: canManage(v, r),
      })),
    };
  });
}

/** Students and parents: published work for the student's (children's) sections, with their own submission. */
export async function listForFamily(v: AssignmentViewer, opts: { take?: number } = {}) {
  if (v.students.length === 0) return [];
  return withRls(v.tenantId, async (tx) => {
    const rows = await tx.assignment.findMany({
      where: { tenantId: v.tenantId, sectionId: { in: v.sectionIds }, status: { in: ["PUBLISHED", "CLOSED"] }, academicYear: { isActive: true } },
      orderBy: [{ dueAt: "desc" }],
      take: opts.take ?? 100,
      include: {
        subject: { select: { name: true } },
        submissions: { where: { studentId: { in: v.students.map((s) => s.id) } }, select: { studentId: true, status: true, isLate: true, isMissing: true, score: true, submittedAt: true } },
      },
    });
    return v.students.map((child) => ({
      student: child,
      assignments: rows
        .filter((a) => a.sectionId === child.sectionId)
        .map((a) => {
          const sub = a.submissions.find((s) => s.studentId === child.id) ?? null;
          const released = Boolean(a.marksReleasedAt);
          return {
            id: a.id,
            title: a.title,
            subject: a.subject.name,
            dueAt: a.dueAt,
            status: a.status,
            mode: a.mode,
            maxScore: a.maxScore ? Number(a.maxScore) : null,
            submission: sub ? { status: sub.status, isLate: sub.isLate, isMissing: sub.isMissing, submittedAt: sub.submittedAt, score: released && sub.status === "MARKED" && sub.score !== null ? Number(sub.score) : null } : null,
          };
        }),
    }));
  });
}

export async function getAssignment(v: AssignmentViewer, id: string) {
  return withRls(v.tenantId, async (tx) => {
    const a = await tx.assignment.findFirst({
      where: { id, tenantId: v.tenantId },
      include: {
        section: { select: { name: true, class: { select: { name: true } } } },
        subject: { select: { name: true } },
        createdBy: { select: { name: true } },
        files: { where: { submissionId: null }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, contentType: true, sizeBytes: true } },
        _count: { select: { submissions: true } },
      },
    });
    if (!a || !canSee(v, a)) return null;
    return { ...a, maxScore: a.maxScore ? Number(a.maxScore) : null, canManage: canManage(v, a) };
  });
}

// ---------------------------------------------------------------------------
// Files: signed upload grants (shared with submissions in 5.2)
// ---------------------------------------------------------------------------

/** Each school's share of file storage (MB), configurable; 500 MB by default. */
export function schoolQuotaBytes(env: Record<string, string | undefined> = process.env): number {
  const mb = Number(env.STORAGE_QUOTA_MB_PER_SCHOOL);
  return (Number.isFinite(mb) && mb > 0 ? mb : 500) * 1024 * 1024;
}

function grantSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return `${s}:upload-grants`;
}

export interface UploadSlot {
  uploadUrl: string;
  grant: string;
}

/**
 * Step 1 of an upload: the server decides the object's name (inside the
 * school's folder), signs a grant for this person, and gets a one-time upload
 * link. The browser then PUTs the file straight to storage.
 */
export async function requestUpload(
  v: AssignmentViewer,
  input: { assignmentId: string; kind: "worksheet" | "submission"; fileName: string; contentType: AllowedType; sizeBytes: number },
  store: ObjectStore = objectStore,
  now: number = Date.now(),
): Promise<UploadSlot> {
  if (!store.configured()) throw new AssignmentError("storageOff");
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_FILE_BYTES) throw new AssignmentError("tooLarge");
  const name = safeFileName(input.fileName, input.contentType);
  const key = objectKey(v.tenantId, input.assignmentId, input.kind, randomBytes(12).toString("hex"), name);
  await withRls(v.tenantId, async (tx) => {
    const a = await loadVisible(tx, v, input.assignmentId);
    if (input.kind === "worksheet") {
      if (!canManage(v, a)) throw new AssignmentError("notAllowed");
      const n = await tx.assignmentFile.count({ where: { tenantId: v.tenantId, assignmentId: a.id, submissionId: null } });
      if (n >= MAX_FILES_PER_ASSIGNMENT) throw new AssignmentError("tooManyFiles");
    } else {
      // Only someone who may hand in for a pupil in this class (checked again on hand-in).
      if (v.role !== "STUDENT" && v.role !== "PARENT") throw new AssignmentError("notAllowed");
      if (!canHandIn(a)) throw new AssignmentError("cannotHandIn");
      if (!v.students.some((s) => s.sectionId === a.sectionId)) throw new AssignmentError("notAllowed");
    }
    // The school's share of file storage.
    const used = await tx.assignmentFile.aggregate({ where: { tenantId: v.tenantId }, _sum: { sizeBytes: true } });
    if ((used._sum.sizeBytes ?? 0) + input.sizeBytes > schoolQuotaBytes()) throw new AssignmentError("quotaFull");
    // Remembered until attached, so an abandoned upload can be cleaned away.
    await tx.pendingUpload.create({ data: { tenantId: v.tenantId, storageKey: key, userId: v.userId } });
  });
  const grant = signGrant({ key, userId: v.userId, assignmentId: input.assignmentId, contentType: input.contentType, fileName: name, expiresAt: now + 2 * 3600_000 }, grantSecret());
  return { uploadUrl: await store.createUploadUrl(key), grant };
}

/**
 * Step 2: check what actually arrived — the grant is ours and for this
 * person, the object exists, it's within the size limit, its bytes are the
 * type it claimed, and the scan hook passes. Anything else is deleted.
 */
export async function verifyUpload(v: AssignmentViewer, token: string, store: ObjectStore = objectStore, now: number = Date.now()): Promise<UploadGrant & { sizeBytes: number }> {
  const g = readGrant(token, grantSecret(), now);
  if (!g || g.userId !== v.userId || !g.key.startsWith(`${v.tenantId}/${g.assignmentId}/`)) throw new AssignmentError("badFile");
  const head = await store.inspect(g.key);
  if (!head) throw new AssignmentError("uploadMissing");
  const reject = async (code: "badFile" | "tooLarge") => {
    await store.remove([g.key]).catch(() => undefined);
    throw new AssignmentError(code);
  };
  if (head.sizeBytes <= 0 || head.sizeBytes > MAX_FILE_BYTES) return reject("tooLarge");
  if (!typeMatches(g.contentType, sniffType(head.head))) return reject("badFile");
  if (!(await scanUpload(g.key))) return reject("badFile");
  return { ...g, sizeBytes: head.sizeBytes };
}

/** Adds a verified worksheet to an assignment. */
export async function attachWorksheet(v: AssignmentViewer, assignmentId: string, token: string, meta: Meta, store: ObjectStore = objectStore) {
  const g = await verifyUpload(v, token, store);
  if (g.assignmentId !== assignmentId || !g.key.includes("/worksheet/")) throw new AssignmentError("badFile");
  return withRls(v.tenantId, async (tx) => {
    const a = await loadManageable(tx, v, assignmentId);
    const n = await tx.assignmentFile.count({ where: { tenantId: v.tenantId, assignmentId: a.id, submissionId: null } });
    if (n >= MAX_FILES_PER_ASSIGNMENT) throw new AssignmentError("tooManyFiles");
    await tx.pendingUpload.deleteMany({ where: { tenantId: v.tenantId, storageKey: g.key } });
    const file = await tx.assignmentFile.upsert({
      where: { storageKey: g.key },
      create: { tenantId: v.tenantId, assignmentId: a.id, storageKey: g.key, fileName: g.fileName, contentType: g.contentType, sizeBytes: g.sizeBytes, uploadedById: v.userId },
      update: {},
    });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "Assignment", entityId: a.id, after: { worksheetAdded: file.fileName } }, tx);
    return file.id;
  });
}

export async function removeWorksheet(v: AssignmentViewer, fileId: string, meta: Meta, store: ObjectStore = objectStore) {
  const key = await withRls(v.tenantId, async (tx) => {
    const f = await tx.assignmentFile.findFirst({ where: { id: fileId, tenantId: v.tenantId, submissionId: null } });
    if (!f) throw new AssignmentError("notFound");
    await loadManageable(tx, v, f.assignmentId);
    await tx.assignmentFile.delete({ where: { id: f.id } });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "Assignment", entityId: f.assignmentId, after: { worksheetRemoved: f.fileName } }, tx);
    return f.storageKey;
  });
  if (store.configured()) await store.remove([key]).catch((err) => console.error("[assignments] could not remove file", err));
}

/**
 * A short-lived download link for a file this person may see: worksheets of
 * assignments they can see; submission files of their own (or their child's)
 * work, or any work in an assignment they manage / a section they teach.
 */
export async function downloadLink(v: AssignmentViewer, fileId: string, store: ObjectStore = objectStore): Promise<string> {
  if (!store.configured()) throw new AssignmentError("storageOff");
  const file = await withRls(v.tenantId, async (tx) => {
    const f = await tx.assignmentFile.findFirst({ where: { id: fileId, tenantId: v.tenantId }, include: { submission: { select: { studentId: true } } } });
    if (!f) throw new AssignmentError("notFound");
    await loadVisible(tx, v, f.assignmentId);
    if (f.submission) {
      const own = v.students.some((s) => s.id === f.submission!.studentId);
      const staff = v.role === "SCHOOL_ADMIN" || v.role === "TEACHER"; // loadVisible already limited teachers to their sections
      if (!own && !staff) throw new AssignmentError("notFound");
    }
    return f;
  });
  return store.createDownloadUrl(file.storageKey, file.fileName, 300);
}

/** What a person may set work for: subjects, each with the sections (active year) they may use. */
export async function assignmentOptions(v: AssignmentViewer) {
  if (v.role !== "SCHOOL_ADMIN" && v.role !== "TEACHER") return [];
  return withRls(v.tenantId, async (tx) => {
    const rows = await tx.classSectionSubject.findMany({
      where: {
        tenantId: v.tenantId,
        section: { class: { academicYear: { isActive: true } } },
        ...(v.role === "TEACHER" ? { OR: v.pairs.length ? v.pairs.map((p) => ({ sectionId: p.sectionId, subjectId: p.subjectId })) : [{ id: "__none__" }] } : {}),
      },
      select: { subject: { select: { id: true, name: true } }, section: { select: { id: true, name: true, class: { select: { name: true, order: true } } } } },
    });
    const bySubject = new Map<string, { id: string; name: string; sections: { id: string; name: string; order: number }[] }>();
    for (const r of rows) {
      const s = bySubject.get(r.subject.id) ?? { id: r.subject.id, name: r.subject.name, sections: [] };
      s.sections.push({ id: r.section.id, name: `${r.section.class.name} ${r.section.name}`, order: r.section.class.order });
      bySubject.set(r.subject.id, s);
    }
    return [...bySubject.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ id: s.id, name: s.name, sections: s.sections.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map(({ id, name }) => ({ id, name })) }));
  });
}
