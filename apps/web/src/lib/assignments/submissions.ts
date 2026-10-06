import { platformPrisma, Prisma, recordAudit, withRls } from "@educore/db";
import { MAX_FILES_PER_SUBMISSION } from "../storage/file-types";
import type { UploadGrant } from "../storage/files";
import { objectStore, type ObjectStore } from "../storage/object-store";
import { loginsAllowedFor, parseStudentLogins } from "../student-logins";
import { AssignmentError, audit, loadManageable, loadVisible, verifyUpload, type AssignmentViewer, type Meta, type Tx } from "./data";
import {
  canHandIn,
  canMarkMissing,
  canResubmit,
  familyView,
  isLate,
  markingState,
  parentsMaySubmit,
  parseAssignmentSettings,
  validScore,
  type AssignmentSettings,
  type MarkingState,
} from "./rules";

/**
 * Handing work in and marking it (Phase 5.2). Pupils hand in their own work;
 * parents for their child when the school allows it; only the people who
 * manage an assignment mark it. Every change is audited. Files are checked
 * (grant, size, real type, scan hook) before they're attached.
 */

// ---------------------------------------------------------------------------
// School setting: may parents hand in?
// ---------------------------------------------------------------------------

function rawSettings(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
}

export async function getAssignmentSettings(tenantId: string): Promise<AssignmentSettings> {
  const t = await platformPrisma().tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return parseAssignmentSettings(rawSettings(t?.settings).assignments);
}

/** School admins only (checked by the caller's permission and here). */
export async function saveAssignmentSettings(v: AssignmentViewer, next: AssignmentSettings, meta: Meta) {
  if (v.role !== "SCHOOL_ADMIN") throw new AssignmentError("notAllowed");
  await platformPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${v.tenantId} FOR UPDATE`;
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: v.tenantId }, select: { settings: true } });
    const raw = rawSettings(t.settings);
    const before = parseAssignmentSettings(raw.assignments);
    await tx.tenant.update({ where: { id: v.tenantId }, data: { settings: { ...raw, assignments: next } as unknown as Prisma.InputJsonValue } });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "Tenant", entityId: v.tenantId, before: { assignments: before }, after: { assignments: next } }, tx);
  });
}

/** For each of this viewer's pupils in the class, may this viewer hand in for them? */
async function handInRights(v: AssignmentViewer, classId: string, sectionId: string): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const mine = v.students.filter((s) => s.sectionId === sectionId);
  if (v.role === "STUDENT") {
    for (const s of mine) out.set(s.id, true);
  } else if (v.role === "PARENT" && mine.length) {
    const t = await platformPrisma().tenant.findUnique({ where: { id: v.tenantId }, select: { settings: true } });
    const raw = rawSettings(t?.settings);
    const ok = parentsMaySubmit(parseAssignmentSettings(raw.assignments), loginsAllowedFor(parseStudentLogins(raw.studentLogins), classId));
    for (const s of mine) out.set(s.id, ok);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Families: see and hand in
// ---------------------------------------------------------------------------

export interface FamilySubmissionView {
  student: { id: string; name: string };
  mayHandIn: boolean;
  submission: null | {
    id: string;
    status: "SUBMITTED" | "RETURNED" | "MARKED";
    text: string;
    isLate: boolean;
    isMissing: boolean;
    submittedAt: Date;
    score: number | null;
    feedback: string | null;
    files: { id: string; fileName: string; sizeBytes: number }[];
  };
}

/** The viewer's own pupil(s) in this assignment's class, with their work. Null if the assignment isn't theirs to see. */
export async function familySubmissions(v: AssignmentViewer, assignmentId: string): Promise<FamilySubmissionView[] | null> {
  if (v.role !== "STUDENT" && v.role !== "PARENT") return null;
  const a = await withRls(v.tenantId, (tx) => loadVisible(tx, v, assignmentId).catch(() => null));
  if (!a) return null;
  const section = await withRls(v.tenantId, (tx) => tx.section.findFirst({ where: { id: a.sectionId, tenantId: v.tenantId }, select: { classId: true } }));
  const rights = await handInRights(v, section?.classId ?? "", a.sectionId);
  const mine = v.students.filter((s) => s.sectionId === a.sectionId);
  const subs = await withRls(v.tenantId, (tx) =>
    tx.assignmentSubmission.findMany({
      where: { tenantId: v.tenantId, assignmentId, studentId: { in: mine.map((s) => s.id) } },
      include: { files: { orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, sizeBytes: true } } },
    }),
  );
  const released = Boolean(a.marksReleasedAt);
  return mine.map((s) => {
    const sub = subs.find((x) => x.studentId === s.id) ?? null;
    const shown = sub ? familyView({ status: sub.status, score: sub.score === null ? null : Number(sub.score), feedback: sub.feedback, isMissing: sub.isMissing }, released) : null;
    return {
      student: { id: s.id, name: s.name },
      mayHandIn: Boolean(rights.get(s.id)) && canHandIn(a) && canResubmit(sub),
      submission: sub
        ? { id: sub.id, status: sub.status, text: sub.text, isLate: sub.isLate, isMissing: sub.isMissing, submittedAt: sub.submittedAt, score: shown!.score, feedback: shown!.feedback, files: sub.files }
        : null,
    };
  });
}

export interface HandInInput {
  assignmentId: string;
  studentId: string;
  text: string;
  /** Signed grants for files just uploaded. */
  grants: string[];
  /** Files already attached that the pupil wants to take out. */
  removeFileIds: string[];
}

/**
 * Hand work in (or hand it in again). The work may be text, files, or both.
 * Late is allowed and flagged. Not once it's marked, the assignment is
 * closed, or it's handed in on paper.
 */
export async function handIn(v: AssignmentViewer, input: HandInInput, meta: Meta, store: ObjectStore = objectStore, now: Date = new Date()) {
  if (v.role !== "STUDENT" && v.role !== "PARENT") throw new AssignmentError("notAllowed");
  // Check every new file first (outside the transaction: it talks to storage).
  const verified: (UploadGrant & { sizeBytes: number })[] = [];
  for (const g of [...new Set(input.grants)]) {
    const f = await verifyUpload(v, g, store);
    if (f.assignmentId !== input.assignmentId || !f.key.includes("/submission/")) throw new AssignmentError("badFile");
    verified.push(f);
  }
  const removedKeys = await withRls(v.tenantId, async (tx) => {
    const a = await loadVisible(tx, v, input.assignmentId);
    const pupil = v.students.find((s) => s.id === input.studentId && s.sectionId === a.sectionId);
    if (!pupil) throw new AssignmentError("notFound");
    const section = await tx.section.findFirstOrThrow({ where: { id: a.sectionId, tenantId: v.tenantId }, select: { classId: true } });
    const rights = await handInRights(v, section.classId, a.sectionId);
    if (!rights.get(pupil.id)) throw new AssignmentError("notAllowed");
    if (!canHandIn(a)) throw new AssignmentError("cannotHandIn");

    // Lock this pupil's row so two devices can't hand in at once.
    await tx.$queryRaw`SELECT id FROM assignment_submissions WHERE "assignmentId" = ${a.id} AND "studentId" = ${pupil.id} FOR UPDATE`;
    const before = await tx.assignmentSubmission.findFirst({ where: { tenantId: v.tenantId, assignmentId: a.id, studentId: pupil.id }, include: { files: true } });
    if (!canResubmit(before)) throw new AssignmentError("alreadyMarked");

    const removing = before ? before.files.filter((f) => input.removeFileIds.includes(f.id)) : [];
    const keeping = (before?.files.length ?? 0) - removing.length;
    if (keeping + verified.length > MAX_FILES_PER_SUBMISSION) throw new AssignmentError("tooManyFiles");
    const text = input.text.trim();
    if (!text && keeping + verified.length === 0) throw new AssignmentError("emptyWork");

    const data = { text, status: "SUBMITTED" as const, submittedAt: now, isLate: isLate(now, a.dueAt), submittedById: v.userId };
    const sub = before
      ? await tx.assignmentSubmission.update({ where: { id: before.id }, data })
      : await tx.assignmentSubmission.create({ data: { ...data, tenantId: v.tenantId, assignmentId: a.id, studentId: pupil.id } });
    if (removing.length) await tx.assignmentFile.deleteMany({ where: { id: { in: removing.map((f) => f.id) }, submissionId: sub.id } });
    for (const f of verified) {
      await tx.pendingUpload.deleteMany({ where: { tenantId: v.tenantId, storageKey: f.key } });
      await tx.assignmentFile.create({
        data: { tenantId: v.tenantId, assignmentId: a.id, submissionId: sub.id, storageKey: f.key, fileName: f.fileName, contentType: f.contentType, sizeBytes: f.sizeBytes, uploadedById: v.userId },
      });
    }
    await recordAudit(
      audit(v, meta),
      {
        action: before ? "UPDATE" : "CREATE",
        entityType: "AssignmentSubmission",
        entityId: sub.id,
        before: before ? { status: before.status, isLate: before.isLate, files: before.files.length } : undefined,
        after: { status: sub.status, isLate: sub.isLate, studentId: pupil.id, filesAdded: verified.map((f) => f.fileName), filesRemoved: removing.map((f) => f.fileName), by: v.role },
      },
      tx,
    );
    return removing.map((f) => f.storageKey);
  });
  if (removedKeys.length && store.configured()) await store.remove(removedKeys).catch((err) => console.error("[submissions] could not remove files", err));
}

// ---------------------------------------------------------------------------
// Staff: the marking view
// ---------------------------------------------------------------------------

export interface MarkingRow {
  student: { id: string; name: string; admissionNo: string };
  state: MarkingState;
  submission: null | {
    id: string;
    text: string;
    submittedAt: Date;
    isLate: boolean;
    score: number | null;
    feedback: string | null;
    submittedBy: "STUDENT" | "PARENT" | "STAFF";
    files: { id: string; fileName: string; sizeBytes: number }[];
  };
}

/** Every active pupil in the class with where their work stands. Staff who can see the assignment. */
export async function markingSheet(v: AssignmentViewer, assignmentId: string): Promise<MarkingRow[] | null> {
  if (v.role !== "SCHOOL_ADMIN" && v.role !== "TEACHER") return null;
  return withRls(v.tenantId, async (tx) => {
    const a = await loadVisible(tx, v, assignmentId).catch(() => null);
    if (!a) return null;
    const [pupils, subs] = await Promise.all([
      tx.student.findMany({ where: { tenantId: v.tenantId, sectionId: a.sectionId, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, admissionNo: true } }),
      tx.assignmentSubmission.findMany({
        where: { tenantId: v.tenantId, assignmentId },
        include: { files: { orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, sizeBytes: true } }, submittedBy: { select: { role: true } } },
      }),
    ]);
    // Pupils who left the class but handed work in still appear.
    const extra = subs.filter((s) => !pupils.some((p) => p.id === s.studentId)).map((s) => s.studentId);
    const gone = extra.length ? await tx.student.findMany({ where: { tenantId: v.tenantId, id: { in: extra } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } }) : [];
    return [...pupils, ...gone].map((p) => {
      const s = subs.find((x) => x.studentId === p.id) ?? null;
      const by = s?.submittedBy?.role;
      return {
        student: { id: p.id, name: `${p.firstName} ${p.lastName}`, admissionNo: p.admissionNo },
        state: markingState(s),
        submission: s
          ? { id: s.id, text: s.text, submittedAt: s.submittedAt, isLate: s.isLate, score: s.score === null ? null : Number(s.score), feedback: s.feedback, submittedBy: by === "STUDENT" ? "STUDENT" : by === "PARENT" ? "PARENT" : "STAFF", files: s.files }
          : null,
      };
    });
  });
}

function checkScore(score: number | null, maxScore: Prisma.Decimal | null) {
  const max = maxScore === null ? null : Number(maxScore);
  if (score === null) return;
  if (!validScore(score, max)) throw new AssignmentError("badScore");
}

async function loadSubmissionForMarking(tx: Tx, v: AssignmentViewer, submissionId: string) {
  const sub = await tx.assignmentSubmission.findFirst({ where: { id: submissionId, tenantId: v.tenantId } });
  if (!sub) throw new AssignmentError("notFound");
  const a = await loadManageable(tx, v, sub.assignmentId);
  return { sub, a };
}

/** Score (if the assignment is scored) and a comment. Marking again changes it. */
export async function markSubmission(v: AssignmentViewer, submissionId: string, input: { score: number | null; feedback: string | null }, meta: Meta, now: Date = new Date()) {
  return withRls(v.tenantId, async (tx) => {
    const { sub, a } = await loadSubmissionForMarking(tx, v, submissionId);
    if (a.maxScore !== null && input.score === null) throw new AssignmentError("badScore");
    checkScore(input.score, a.maxScore);
    const after = await tx.assignmentSubmission.update({
      where: { id: sub.id },
      data: { status: "MARKED", score: input.score === null ? null : new Prisma.Decimal(input.score), feedback: input.feedback || null, markedAt: now, markedById: v.userId },
    });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "AssignmentSubmission", entityId: sub.id, before: { status: sub.status, score: sub.score, feedback: sub.feedback }, after: { status: after.status, score: after.score, feedback: after.feedback } }, tx);
    return { assignmentId: a.id, studentId: sub.studentId };
  });
}

/** Send it back for corrections, with a comment; the pupil can hand it in again. Also lets a "not handed in" pupil hand in late. */
export async function returnSubmission(v: AssignmentViewer, submissionId: string, feedback: string, meta: Meta) {
  if (!feedback.trim()) throw new AssignmentError("feedbackNeeded");
  return withRls(v.tenantId, async (tx) => {
    const { sub, a } = await loadSubmissionForMarking(tx, v, submissionId);
    const after = await tx.assignmentSubmission.update({
      where: { id: sub.id },
      data: { status: "RETURNED", isMissing: false, score: null, feedback: feedback.trim(), markedAt: null, markedById: v.userId },
    });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "AssignmentSubmission", entityId: sub.id, before: { status: sub.status, score: sub.score, isMissing: sub.isMissing }, after: { status: after.status, feedback: after.feedback } }, tx);
    return { assignmentId: a.id, studentId: sub.studentId };
  });
}

/** A teacher records work handed in on paper (or seen in class), with its mark. */
export async function recordWork(v: AssignmentViewer, assignmentId: string, studentId: string, input: { score: number | null; feedback: string | null }, meta: Meta, now: Date = new Date()) {
  return withRls(v.tenantId, async (tx) => {
    const a = await loadManageable(tx, v, assignmentId);
    if (a.status === "DRAFT") throw new AssignmentError("invalidState");
    const pupil = await tx.student.findFirst({ where: { id: studentId, tenantId: v.tenantId, sectionId: a.sectionId }, select: { id: true } });
    if (!pupil) throw new AssignmentError("notFound");
    if (a.maxScore !== null && input.score === null) throw new AssignmentError("badScore");
    checkScore(input.score, a.maxScore);
    await tx.$queryRaw`SELECT id FROM assignment_submissions WHERE "assignmentId" = ${a.id} AND "studentId" = ${pupil.id} FOR UPDATE`;
    const before = await tx.assignmentSubmission.findFirst({ where: { tenantId: v.tenantId, assignmentId: a.id, studentId: pupil.id } });
    const data = { status: "MARKED" as const, isMissing: false, score: input.score === null ? null : new Prisma.Decimal(input.score), feedback: input.feedback || null, markedAt: now, markedById: v.userId };
    const sub = before
      ? await tx.assignmentSubmission.update({ where: { id: before.id }, data })
      : await tx.assignmentSubmission.create({ data: { ...data, tenantId: v.tenantId, assignmentId: a.id, studentId: pupil.id, submittedAt: now, isLate: isLate(now, a.dueAt), submittedById: v.userId } });
    await recordAudit(audit(v, meta), { action: before ? "UPDATE" : "CREATE", entityType: "AssignmentSubmission", entityId: sub.id, before: before ? { status: before.status, score: before.score } : undefined, after: { status: sub.status, score: sub.score, recordedByStaff: true, studentId: pupil.id } }, tx);
  });
}

/** After the due date: everyone with nothing at all is recorded as "not handed in" (0 if the work is scored). */
export async function markMissing(v: AssignmentViewer, assignmentId: string, meta: Meta, now: Date = new Date()): Promise<number> {
  return withRls(v.tenantId, async (tx) => {
    const a = await loadManageable(tx, v, assignmentId);
    if (!canMarkMissing(a, now)) throw new AssignmentError("notYetDue");
    const [pupils, existing] = await Promise.all([
      tx.student.findMany({ where: { tenantId: v.tenantId, sectionId: a.sectionId, status: "ACTIVE" }, select: { id: true } }),
      tx.assignmentSubmission.findMany({ where: { tenantId: v.tenantId, assignmentId: a.id }, select: { studentId: true } }),
    ]);
    const missing = pupils.filter((p) => !existing.some((e) => e.studentId === p.id)).map((p) => p.id);
    if (missing.length === 0) return 0;
    await tx.assignmentSubmission.createMany({
      data: missing.map((studentId) => ({
        tenantId: v.tenantId,
        assignmentId: a.id,
        studentId,
        status: "MARKED" as const,
        isMissing: true,
        isLate: false,
        submittedAt: now,
        score: a.maxScore === null ? null : new Prisma.Decimal(0),
        markedAt: now,
        markedById: v.userId,
      })),
      skipDuplicates: true,
    });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "Assignment", entityId: a.id, after: { markedNotHandedIn: missing.length, studentIds: missing } }, tx);
    return missing.length;
  });
}

/** Let families see the scores (or hide them again). */
export async function releaseMarks(v: AssignmentViewer, assignmentId: string, release: boolean, meta: Meta, now: Date = new Date()) {
  return withRls(v.tenantId, async (tx) => {
    const a = await loadManageable(tx, v, assignmentId);
    if (a.status === "DRAFT") throw new AssignmentError("invalidState");
    const after = await tx.assignment.update({ where: { id: a.id }, data: { marksReleasedAt: release ? (a.marksReleasedAt ?? now) : null } });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "Assignment", entityId: a.id, before: { marksReleasedAt: a.marksReleasedAt }, after: { marksReleasedAt: after.marksReleasedAt } }, tx);
    const marked = await tx.assignmentSubmission.findMany({ where: { tenantId: v.tenantId, assignmentId: a.id, status: "MARKED" }, select: { studentId: true } });
    return { assignmentId: a.id, studentIds: release && !a.marksReleasedAt ? marked.map((m) => m.studentId) : [] };
  });
}

// ---------------------------------------------------------------------------
// Housekeeping: uploads that were never attached
// ---------------------------------------------------------------------------

/** Deletes stored objects for uploads started over a day ago and never attached. Runs across schools (platform job). */
export async function cleanAbandonedUploads(store: ObjectStore = objectStore, now: Date = new Date(), batch = 200): Promise<number> {
  if (!store.configured()) return 0;
  const db = platformPrisma();
  const stale = await db.pendingUpload.findMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3600_000) } }, orderBy: { createdAt: "asc" }, take: batch, select: { id: true, storageKey: true } });
  if (stale.length === 0) return 0;
  // Never delete an object that did get attached (belt and braces).
  const attached = new Set((await db.assignmentFile.findMany({ where: { storageKey: { in: stale.map((s) => s.storageKey) } }, select: { storageKey: true } })).map((f) => f.storageKey));
  const orphans = stale.filter((s) => !attached.has(s.storageKey)).map((s) => s.storageKey);
  if (orphans.length) await store.remove(orphans);
  await db.pendingUpload.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  return orphans.length;
}
