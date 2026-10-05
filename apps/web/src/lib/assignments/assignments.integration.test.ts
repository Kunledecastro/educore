import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@educore/db";
import type { ObjectStore } from "../storage/object-store";
import {
  AssignmentError,
  assignmentOptions,
  assignmentViewer,
  attachWorksheet,
  createAssignments,
  deleteAssignment,
  downloadLink,
  getAssignment,
  listForFamily,
  listForStaff,
  removeWorksheet,
  requestUpload,
  setAssignmentStatus,
  updateAssignment,
  type AssignmentViewer,
} from "./data";

/**
 * Assignments against a real Postgres (migrations through 0025), with an
 * in-memory stand-in for file storage: who may set work for which class,
 * who sees what (never drafts for families), the upload checks, file
 * downloads, deleting, and school-to-school isolation.
 */

process.env.NEXTAUTH_SECRET ??= "test-secret-for-upload-grants";

class MemoryStore implements ObjectStore {
  objects = new Map<string, Uint8Array>();
  removed: string[] = [];
  configured() {
    return true;
  }
  async createUploadUrl(key: string) {
    return `memory://upload/${key}`;
  }
  async inspect(key: string) {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.length, head: o.slice(0, 16) } : null;
  }
  async createDownloadUrl(key: string, name: string) {
    return `memory://download/${key}?download=${name}`;
  }
  async remove(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
    this.removed.push(...keys);
  }
  /** What the browser would do with the upload link. */
  put(uploadUrl: string, bytes: Uint8Array) {
    this.objects.set(uploadUrl.replace("memory://upload/", ""), bytes);
  }
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
const store = new MemoryStore();
let A: string;
let B: string;
const ids: Record<string, string> = {};
const v: Record<string, AssignmentViewer> = {};
const inAWeek = () => new Date(Date.now() + 7 * 86400_000);
const input = (over: Partial<Parameters<typeof createAssignments>[1]> = {}) => ({
  title: "Fractions worksheet",
  instructions: "Do questions 1–10.",
  dueAt: inAWeek(),
  maxScore: 20,
  mode: "ONLINE" as const,
  sectionIds: [ids.s1a!],
  subjectId: ids.maths!,
  publish: true,
  ...over,
});

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "TEACHER" | "PARENT" | "STUDENT" | "ACCOUNTANT") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@asg.test`, name: key, role } })).id;
  return ids[key]!;
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Asg A", slug: `asg-a-${stamp}`, subdomain: `asg-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Asg B", slug: `asg-b-${stamp}`, subdomain: `asg-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const now = new Date();
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "Current", startDate: new Date(now.getTime() - 200 * 86400_000), endDate: new Date(now.getTime() + 200 * 86400_000), isActive: true } });
  ids.term = (await prisma.term.create({ data: { tenantId: A, academicYearId: year.id, name: "This term", order: 1, startDate: new Date(now.getTime() - 30 * 86400_000), endDate: new Date(now.getTime() + 60 * 86400_000) } })).id;
  const jss1 = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name: "JSS1" } });
  await Promise.all([
    user(A, "admin", "SCHOOL_ADMIN"),
    user(A, "t1", "TEACHER"),
    user(A, "t2", "TEACHER"),
    user(A, "p1", "PARENT"),
    user(A, "p2", "PARENT"),
    user(A, "st1", "STUDENT"),
    user(A, "bursar", "ACCOUNTANT"),
    user(B, "bAdmin", "SCHOOL_ADMIN"),
  ]);
  const [t1, t2] = await Promise.all([
    prisma.teacher.create({ data: { tenantId: A, userId: ids.t1!, employeeId: `AT1-${stamp}` } }),
    prisma.teacher.create({ data: { tenantId: A, userId: ids.t2!, employeeId: `AT2-${stamp}` } }),
  ]);
  const s1a = await prisma.section.create({ data: { tenantId: A, classId: jss1.id, name: "A" } });
  const s1b = await prisma.section.create({ data: { tenantId: A, classId: jss1.id, name: "B", formTeacherId: t2.id } });
  ids.s1a = s1a.id;
  ids.s1b = s1b.id;
  const [maths, english] = await Promise.all([
    prisma.subject.create({ data: { tenantId: A, name: "Mathematics", code: `AM${stamp}`.slice(0, 12) } }),
    prisma.subject.create({ data: { tenantId: A, name: "English", code: `AE${stamp}`.slice(0, 12) } }),
  ]);
  ids.maths = maths.id;
  ids.english = english.id;
  // t1 teaches maths in both arms; t2 teaches English in A and is form teacher of B.
  await prisma.classSectionSubject.createMany({
    data: [
      { tenantId: A, sectionId: s1a.id, subjectId: maths.id, teacherId: t1.id },
      { tenantId: A, sectionId: s1b.id, subjectId: maths.id, teacherId: t1.id },
      { tenantId: A, sectionId: s1a.id, subjectId: english.id, teacherId: t2.id },
    ],
  });
  const mk = (n: string, sectionId: string, userId?: string) =>
    prisma.student.create({ data: { tenantId: A, admissionNo: `AS-${stamp}-${n}`, firstName: n, lastName: "Pupil", academicYearId: year.id, classId: jss1.id, sectionId, userId } });
  const [ada, bola] = await Promise.all([mk("Ada", s1a.id, ids.st1), mk("Bola", s1b.id)]);
  ids.ada = ada.id;
  ids.bola = bola.id;
  for (const [p, s] of [["p1", ada.id], ["p2", bola.id]] as const) {
    const g = await prisma.guardian.create({ data: { tenantId: A, userId: ids[p]! } });
    await prisma.studentGuardian.create({ data: { tenantId: A, studentId: s, guardianId: g.id, relationship: "FATHER" } });
  }
  for (const [k, role] of [["admin", "SCHOOL_ADMIN"], ["t1", "TEACHER"], ["t2", "TEACHER"], ["p1", "PARENT"], ["p2", "PARENT"], ["st1", "STUDENT"], ["bursar", "ACCOUNTANT"]] as const) {
    v[k] = await assignmentViewer(A, { id: ids[k]!, role });
  }
  v.bAdmin = await assignmentViewer(B, { id: ids.bAdmin!, role: "SCHOOL_ADMIN" });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined); // audit log is append-only
  await prisma.$disconnect();
});

describe("who sets work for which class", () => {
  it("each teacher is offered only the subjects and classes they teach", async () => {
    expect(await assignmentOptions(v.t1!)).toEqual([{ id: ids.maths, name: "Mathematics", sections: [{ id: ids.s1a, name: "JSS1 A" }, { id: ids.s1b, name: "JSS1 B" }] }]);
    expect((await assignmentOptions(v.t2!)).map((s) => s.name)).toEqual(["English"]);
    expect((await assignmentOptions(v.admin!)).map((s) => s.name)).toEqual(["English", "Mathematics"]);
    expect(await assignmentOptions(v.p1!)).toEqual([]);
    expect(await assignmentOptions(v.bAdmin!)).toEqual([]);
  });

  it("a teacher sets one assignment for several classes at once; the term is found from the due date", async () => {
    const created = await createAssignments(v.t1!, input({ sectionIds: [ids.s1a!, ids.s1b!] }), meta);
    expect(created).toHaveLength(2);
    const rows = await prisma.assignment.findMany({ where: { id: { in: created } } });
    expect(rows.every((r) => r.termId === ids.term && r.status === "PUBLISHED" && r.publishedAt && r.createdById === ids.t1)).toBe(true);
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "Assignment", action: "CREATE" } })).toBe(2);
    ids.mathsA = rows.find((r) => r.sectionId === ids.s1a)!.id;
    ids.mathsB = rows.find((r) => r.sectionId === ids.s1b)!.id;
  });

  it("nobody sets work for a subject/class they don't teach", async () => {
    await expect(createAssignments(v.t2!, input(), meta)).rejects.toEqual(new AssignmentError("notAllowed")); // t2 doesn't teach maths
    await expect(createAssignments(v.t2!, input({ subjectId: ids.english!, sectionIds: [ids.s1b!] }), meta)).rejects.toEqual(new AssignmentError("notAllowed")); // form teacher, but not English there
    await expect(createAssignments(v.p1!, input(), meta)).rejects.toEqual(new AssignmentError("notAllowed"));
    await expect(createAssignments(v.bAdmin!, input(), meta)).rejects.toEqual(new AssignmentError("notFound")); // another school's class
  });

  it("can't publish with a due date in the past (a draft can)", async () => {
    await expect(createAssignments(v.t1!, input({ dueAt: new Date(Date.now() - 86400_000) }), meta)).rejects.toEqual(new AssignmentError("badDue"));
    ids.draft = (await createAssignments(v.admin!, input({ title: "Draft essay", subjectId: ids.english!, publish: false }), meta))[0]!;
  });
});

describe("who sees what", () => {
  it("families see published work for their own child's class — never drafts", async () => {
    const titles = async (k: string) => (await listForFamily(v[k]!)).flatMap((c) => c.assignments.map((a) => a.id)).sort();
    expect(await titles("p1")).toEqual([ids.mathsA]);
    expect(await titles("st1")).toEqual([ids.mathsA]);
    expect(await titles("p2")).toEqual([ids.mathsB]);
    expect(await getAssignment(v.p1!, ids.mathsB!)).toBeNull(); // another class
    expect(await getAssignment(v.p1!, ids.draft!)).toBeNull(); // draft
    expect(await getAssignment(v.st1!, ids.mathsA!)).toMatchObject({ title: "Fractions worksheet", canManage: false });
  });

  it("staff lists: admins all, teachers their classes (form teachers can see, not manage)", async () => {
    const list = async (k: string) => (await listForStaff(v[k]!)).rows.map((r) => [r.id, r.canManage]);
    expect((await list("admin")).length).toBe(3);
    expect(await list("t1")).toEqual(expect.arrayContaining([[ids.mathsA, true], [ids.mathsB, true]]));
    expect((await list("t1")).map((r) => r[0])).not.toContain(ids.draft); // a colleague's draft in a class t1 teaches
    expect(await getAssignment(v.t1!, ids.draft!)).toBeNull();
    expect(await list("t2")).toEqual(expect.arrayContaining([[ids.mathsB, false], [ids.draft, true]]));
    expect(await list("bAdmin")).toEqual([]);
    expect(await getAssignment(v.bAdmin!, ids.mathsA!)).toBeNull();
    expect(await getAssignment(v.bursar!, ids.mathsA!)).toBeNull();
  });

  it("the class size and counts come back for staff", async () => {
    const row = (await listForStaff(v.t1!)).rows.find((r) => r.id === ids.mathsA)!;
    expect(row).toMatchObject({ className: "JSS1 A", subject: "Mathematics", handedIn: 0, classSize: 1, toMark: 0 });
  });
});

describe("changing assignments", () => {
  it("only the people who manage it can edit, publish or close it", async () => {
    const edit = { title: "Fractions (updated)", instructions: "Do 1–12.", dueAt: inAWeek(), maxScore: 24, mode: "ONLINE" as const };
    await updateAssignment(v.t1!, ids.mathsA!, edit, meta);
    await expect(updateAssignment(v.t2!, ids.mathsB!, edit, meta)).rejects.toEqual(new AssignmentError("notAllowed")); // form teacher can see, not manage
    await expect(updateAssignment(v.p1!, ids.mathsA!, edit, meta)).rejects.toEqual(new AssignmentError("notAllowed")); // can see, can't change
    await expect(updateAssignment(v.bAdmin!, ids.mathsA!, edit, meta)).rejects.toEqual(new AssignmentError("notFound"));
    await setAssignmentStatus(v.t1!, ids.mathsB!, "CLOSED", meta);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: ids.mathsB! } })).status).toBe("CLOSED");
    await setAssignmentStatus(v.t1!, ids.mathsB!, "PUBLISHED", meta); // reopen
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: ids.mathsB! } })).toMatchObject({ status: "PUBLISHED", closedAt: null });
    await expect(setAssignmentStatus(v.admin!, ids.draft!, "CLOSED", meta)).rejects.toEqual(new AssignmentError("invalidState"));
  });

  it("can't change how work is handed in, or lower the maximum below a mark, once work is in", async () => {
    await prisma.assignmentSubmission.create({ data: { tenantId: A, assignmentId: ids.mathsA!, studentId: ids.ada!, text: "My answers", score: 22, status: "MARKED", markedAt: new Date() } });
    const base = { title: "Fractions", instructions: "", dueAt: inAWeek(), maxScore: 24, mode: "ONLINE" as const };
    await expect(updateAssignment(v.t1!, ids.mathsA!, { ...base, mode: "PAPER" }, meta)).rejects.toEqual(new AssignmentError("modeLocked"));
    await expect(updateAssignment(v.t1!, ids.mathsA!, { ...base, maxScore: 20 }, meta)).rejects.toEqual(new AssignmentError("scoreBelowMarks"));
    await expect(deleteAssignment(v.t1!, ids.mathsA!, meta, store)).rejects.toEqual(new AssignmentError("hasWork"));
  });
});

describe("worksheets", () => {
  it("upload → check → attach; families can then download", async () => {
    const slot = await requestUpload(v.t1!, { assignmentId: ids.mathsB!, kind: "worksheet", fileName: "../../Fractions sheet.pdf", contentType: "application/pdf", sizeBytes: PDF.length }, store);
    expect(slot.uploadUrl).toMatch(new RegExp(`^memory://upload/${A}/${ids.mathsB}/worksheet/`));
    store.put(slot.uploadUrl, PDF);
    ids.file = await attachWorksheet(v.t1!, ids.mathsB!, slot.grant, meta, store);
    const file = await prisma.assignmentFile.findUniqueOrThrow({ where: { id: ids.file } });
    expect(file).toMatchObject({ fileName: "Fractions sheet.pdf", contentType: "application/pdf", sizeBytes: PDF.length, submissionId: null });
    expect(await downloadLink(v.p2!, ids.file!, store)).toContain(file.storageKey);
    await expect(downloadLink(v.p1!, ids.file!, store)).rejects.toEqual(new AssignmentError("notFound")); // another class
    await expect(downloadLink(v.bAdmin!, ids.file!, store)).rejects.toEqual(new AssignmentError("notFound")); // another school
  });

  it("a file that isn't what it claims is rejected and deleted", async () => {
    const slot = await requestUpload(v.t1!, { assignmentId: ids.mathsB!, kind: "worksheet", fileName: "sheet.pdf", contentType: "application/pdf", sizeBytes: EXE.length }, store);
    store.put(slot.uploadUrl, EXE);
    await expect(attachWorksheet(v.t1!, ids.mathsB!, slot.grant, meta, store)).rejects.toEqual(new AssignmentError("badFile"));
    expect(store.objects.has(slot.uploadUrl.replace("memory://upload/", ""))).toBe(false);
  });

  it("grants are personal and can't be moved to another assignment or forged", async () => {
    const slot = await requestUpload(v.t1!, { assignmentId: ids.mathsB!, kind: "worksheet", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: PDF.length }, store);
    store.put(slot.uploadUrl, PDF);
    await expect(attachWorksheet(v.admin!, ids.mathsB!, slot.grant, meta, store)).rejects.toEqual(new AssignmentError("badFile")); // someone else's grant
    await expect(attachWorksheet(v.t1!, ids.mathsA!, slot.grant, meta, store)).rejects.toEqual(new AssignmentError("badFile")); // other assignment
    const [payload] = slot.grant.split(".");
    await expect(attachWorksheet(v.t1!, ids.mathsB!, `${payload}.forged`, meta, store)).rejects.toEqual(new AssignmentError("badFile"));
    // Not uploaded at all:
    const empty = await requestUpload(v.t1!, { assignmentId: ids.mathsB!, kind: "worksheet", fileName: "b.pdf", contentType: "application/pdf", sizeBytes: 10 }, store);
    await expect(attachWorksheet(v.t1!, ids.mathsB!, empty.grant, meta, store)).rejects.toEqual(new AssignmentError("uploadMissing"));
  });

  it("only managers may request worksheet uploads; size is capped", async () => {
    await expect(requestUpload(v.t2!, { assignmentId: ids.mathsB!, kind: "worksheet", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }, store)).rejects.toEqual(new AssignmentError("notAllowed"));
    await expect(requestUpload(v.p2!, { assignmentId: ids.mathsB!, kind: "worksheet", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }, store)).rejects.toEqual(new AssignmentError("notAllowed"));
    await expect(requestUpload(v.bAdmin!, { assignmentId: ids.mathsB!, kind: "worksheet", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }, store)).rejects.toEqual(new AssignmentError("notFound"));
    await expect(requestUpload(v.t1!, { assignmentId: ids.mathsB!, kind: "worksheet", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 11 * 1024 * 1024 }, store)).rejects.toEqual(new AssignmentError("tooLarge"));
  });

  it("removing a worksheet deletes the stored file too", async () => {
    const key = (await prisma.assignmentFile.findUniqueOrThrow({ where: { id: ids.file! } })).storageKey;
    await expect(removeWorksheet(v.t2!, ids.file!, meta, store)).rejects.toEqual(new AssignmentError("notAllowed"));
    await removeWorksheet(v.t1!, ids.file!, meta, store);
    expect(store.removed).toContain(key);
    expect(await prisma.assignmentFile.count({ where: { id: ids.file! } })).toBe(0);
  });

  it("the database refuses a file row pointing into another school's folder", async () => {
    await expect(prisma.assignmentFile.create({ data: { tenantId: A, assignmentId: ids.mathsB!, storageKey: `${B}/x/worksheet/y.pdf`, fileName: "y.pdf", contentType: "application/pdf", sizeBytes: 10 } })).rejects.toThrow();
  });
});

describe("deleting", () => {
  it("an assignment with no work handed in can be deleted, with its files", async () => {
    const slot = await requestUpload(v.admin!, { assignmentId: ids.draft!, kind: "worksheet", fileName: "essay.pdf", contentType: "application/pdf", sizeBytes: PDF.length }, store);
    store.put(slot.uploadUrl, PDF);
    await attachWorksheet(v.admin!, ids.draft!, slot.grant, meta, store);
    await expect(deleteAssignment(v.t1!, ids.draft!, meta, store)).rejects.toEqual(new AssignmentError("notFound")); // can't even see a colleague's draft
    await expect(deleteAssignment(v.t2!, ids.mathsB!, meta, store)).rejects.toEqual(new AssignmentError("notAllowed")); // form teacher: sees, can't delete
    await deleteAssignment(v.admin!, ids.draft!, meta, store);
    expect(await prisma.assignment.count({ where: { id: ids.draft! } })).toBe(0);
    expect(store.removed.some((k) => k.startsWith(`${A}/${ids.draft}/`))).toBe(true);
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "Assignment", entityId: ids.draft!, action: "DELETE" } })).toBe(1);
  });
});
