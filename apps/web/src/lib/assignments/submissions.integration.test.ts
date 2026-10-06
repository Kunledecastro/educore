import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@educore/db";
import type { ObjectStore } from "../storage/object-store";
import { AssignmentError, assignmentViewer, createAssignments, downloadLink, listForFamily, requestUpload, type AssignmentViewer } from "./data";
import { cleanAbandonedUploads, familySubmissions, handIn, markingSheet, markMissing, markSubmission, recordWork, releaseMarks, returnSubmission, saveAssignmentSettings } from "./submissions";

/**
 * Handing in and marking against a real Postgres (migrations through 0026):
 * pupils hand in only their own work; parents only for their own child and
 * only when the school allows; late flags; resubmitting until marked;
 * returning for corrections; what families see before and after marks are
 * released; "not handed in"; paper work; files; storage quota; abandoned
 * uploads; and school-to-school isolation.
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
  put(uploadUrl: string, bytes: Uint8Array) {
    this.objects.set(uploadUrl.replace("memory://upload/", ""), bytes);
  }
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5, 6, 7]);
const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
const store = new MemoryStore();
let A: string;
let B: string;
const ids: Record<string, string> = {};
const v: Record<string, AssignmentViewer> = {};
const DAY = 86400_000;

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "TEACHER" | "PARENT" | "STUDENT") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@sub.test`, name: key, role } })).id;
  return ids[key]!;
}

async function upload(viewer: AssignmentViewer, assignmentId: string, bytes = JPEG) {
  const slot = await requestUpload(viewer, { assignmentId, kind: "submission", fileName: "page1.jpg", contentType: "image/jpeg", sizeBytes: bytes.length }, store);
  store.put(slot.uploadUrl, bytes);
  return slot.grant;
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Sub A", slug: `sub-a-${stamp}`, subdomain: `sub-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Sub B", slug: `sub-b-${stamp}`, subdomain: `sub-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const now = Date.now();
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "Current", startDate: new Date(now - 200 * DAY), endDate: new Date(now + 200 * DAY), isActive: true } });
  const [jss1, jss2] = await Promise.all(["JSS1", "JSS2"].map((name) => prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name } })));
  // JSS1 pupils have logins; JSS2 pupils don't (so their parents hand in, by default).
  await prisma.tenant.update({ where: { id: A }, data: { settings: { studentLogins: { enabled: true, classIds: [jss1!.id] } } } });
  await Promise.all([user(A, "admin", "SCHOOL_ADMIN"), user(A, "t1", "TEACHER"), user(A, "t2", "TEACHER"), user(A, "p1", "PARENT"), user(A, "p2", "PARENT"), user(A, "st1", "STUDENT"), user(A, "st2", "STUDENT"), user(B, "bAdmin", "SCHOOL_ADMIN")]);
  const [t1, t2] = await Promise.all([
    prisma.teacher.create({ data: { tenantId: A, userId: ids.t1!, employeeId: `ST1-${stamp}` } }),
    prisma.teacher.create({ data: { tenantId: A, userId: ids.t2!, employeeId: `ST2-${stamp}` } }),
  ]);
  const s1 = await prisma.section.create({ data: { tenantId: A, classId: jss1!.id, name: "A", formTeacherId: t2.id } });
  const s2 = await prisma.section.create({ data: { tenantId: A, classId: jss2!.id, name: "A" } });
  ids.s1 = s1.id;
  ids.s2 = s2.id;
  const maths = await prisma.subject.create({ data: { tenantId: A, name: "Mathematics", code: `SM${stamp}`.slice(0, 12) } });
  ids.maths = maths.id;
  await prisma.classSectionSubject.createMany({ data: [s1.id, s2.id].map((sectionId) => ({ tenantId: A, sectionId, subjectId: maths.id, teacherId: t1.id })) });
  const mk = (n: string, classId: string, sectionId: string, userId?: string) =>
    prisma.student.create({ data: { tenantId: A, admissionNo: `SB-${stamp}-${n}`, firstName: n, lastName: "Pupil", academicYearId: year.id, classId, sectionId, userId } });
  const [ada, chi, bola] = await Promise.all([mk("Ada", jss1!.id, s1.id, ids.st1), mk("Chi", jss1!.id, s1.id, ids.st2), mk("Bola", jss2!.id, s2.id)]);
  ids.ada = ada.id;
  ids.chi = chi.id;
  ids.bola = bola.id;
  for (const [p, s] of [["p1", ada.id], ["p2", bola.id]] as const) {
    const g = await prisma.guardian.create({ data: { tenantId: A, userId: ids[p]! } });
    await prisma.studentGuardian.create({ data: { tenantId: A, studentId: s, guardianId: g.id, relationship: "MOTHER" } });
  }
  for (const [k, role] of [["admin", "SCHOOL_ADMIN"], ["t1", "TEACHER"], ["t2", "TEACHER"], ["p1", "PARENT"], ["p2", "PARENT"], ["st1", "STUDENT"], ["st2", "STUDENT"]] as const) {
    v[k] = await assignmentViewer(A, { id: ids[k]!, role });
  }
  v.bAdmin = await assignmentViewer(B, { id: ids.bAdmin!, role: "SCHOOL_ADMIN" });
  const base = { instructions: "", maxScore: 10, mode: "ONLINE" as const, subjectId: maths.id, publish: true };
  ids.hw1 = (await createAssignments(v.t1!, { ...base, title: "HW1", dueAt: new Date(now + 3 * DAY), sectionIds: [s1.id] }, meta))[0]!;
  ids.hw2 = (await createAssignments(v.t1!, { ...base, title: "HW2", dueAt: new Date(now + 3 * DAY), sectionIds: [s2.id] }, meta))[0]!;
  ids.paper = (await createAssignments(v.t1!, { ...base, title: "Paper", mode: "PAPER", dueAt: new Date(now + 3 * DAY), sectionIds: [s1.id] }, meta))[0]!;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

const handInFor = (k: string, assignmentId: string, studentId: string, over: Partial<Parameters<typeof handIn>[1]> = {}, now?: Date) =>
  handIn(v[k]!, { assignmentId, studentId, text: "My answers", grants: [], removeFileIds: [], ...over }, meta, store, now);

describe("who may hand in", () => {
  it("a pupil hands in their own work — text and a photo — and only their own", async () => {
    const grant = await upload(v.st1!, ids.hw1!);
    await handInFor("st1", ids.hw1!, ids.ada!, { grants: [grant] });
    const sub = await prisma.assignmentSubmission.findFirstOrThrow({ where: { assignmentId: ids.hw1, studentId: ids.ada }, include: { files: true } });
    expect(sub).toMatchObject({ status: "SUBMITTED", isLate: false, text: "My answers", submittedById: ids.st1 });
    expect(sub.files).toHaveLength(1);
    expect(await prisma.pendingUpload.count({ where: { storageKey: sub.files[0]!.storageKey } })).toBe(0);
    await expect(handInFor("st1", ids.hw1!, ids.chi!)).rejects.toEqual(new AssignmentError("notFound")); // a classmate
    await expect(handInFor("st1", ids.hw2!, ids.bola!)).rejects.toEqual(new AssignmentError("notFound")); // another class
    await expect(handInFor("bAdmin", ids.hw1!, ids.ada!)).rejects.toEqual(new AssignmentError("notAllowed"));
    await expect(requestUpload(v.st1!, { assignmentId: ids.hw2!, kind: "submission", fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 10 }, store)).rejects.toEqual(new AssignmentError("notFound"));
  });

  it("parents hand in for their child only where the school allows it", async () => {
    // JSS1 has logins → by default the parent can't hand in there; JSS2 has none → they can.
    await expect(handInFor("p1", ids.hw1!, ids.ada!)).rejects.toEqual(new AssignmentError("notAllowed"));
    await handInFor("p2", ids.hw2!, ids.bola!, { text: "Bola's answers (photo of exercise book)" });
    await expect(handInFor("p2", ids.hw1!, ids.ada!)).rejects.toEqual(new AssignmentError("notFound")); // not their child
    await saveAssignmentSettings(v.admin!, { parentSubmit: "never" }, meta);
    await expect(handInFor("p2", ids.hw2!, ids.bola!)).rejects.toEqual(new AssignmentError("notAllowed"));
    await saveAssignmentSettings(v.admin!, { parentSubmit: "always" }, meta);
    expect((await familySubmissions(v.p1!, ids.hw1!))![0]!.mayHandIn).toBe(true);
    await saveAssignmentSettings(v.admin!, { parentSubmit: "auto" }, meta);
    await expect(saveAssignmentSettings(v.t1!, { parentSubmit: "always" }, meta)).rejects.toEqual(new AssignmentError("notAllowed"));
  });

  it("nothing for paper work, closed work, or an empty hand-in", async () => {
    await expect(handInFor("st1", ids.paper!, ids.ada!)).rejects.toEqual(new AssignmentError("cannotHandIn"));
    await expect(handInFor("st2", ids.hw1!, ids.chi!, { text: "  " })).rejects.toEqual(new AssignmentError("emptyWork"));
  });

  it("late is allowed and flagged; handing in again replaces the work", async () => {
    await handInFor("st2", ids.hw1!, ids.chi!, { text: "first try" });
    await handInFor("st2", ids.hw1!, ids.chi!, { text: "second try" }, new Date(Date.now() + 5 * DAY));
    const sub = await prisma.assignmentSubmission.findFirstOrThrow({ where: { assignmentId: ids.hw1, studentId: ids.chi } });
    expect(sub).toMatchObject({ text: "second try", isLate: true, status: "SUBMITTED" });
    expect(await prisma.assignmentSubmission.count({ where: { assignmentId: ids.hw1, studentId: ids.chi } })).toBe(1);
  });

  it("a pupil can take a file out before it's marked", async () => {
    const file = await prisma.assignmentFile.findFirstOrThrow({ where: { assignmentId: ids.hw1, submission: { studentId: ids.ada } } });
    await handInFor("st1", ids.hw1!, ids.ada!, { removeFileIds: [file.id] });
    expect(await prisma.assignmentFile.count({ where: { id: file.id } })).toBe(0);
    expect(store.removed).toContain(file.storageKey);
  });
});

describe("files on handed-in work", () => {
  it("the pupil, their parent and the class's teachers can download; a classmate and other schools can't", async () => {
    const grant = await upload(v.st1!, ids.hw1!);
    await handInFor("st1", ids.hw1!, ids.ada!, { grants: [grant] });
    const file = await prisma.assignmentFile.findFirstOrThrow({ where: { assignmentId: ids.hw1, submission: { studentId: ids.ada } } });
    for (const k of ["st1", "p1", "t1", "t2", "admin"]) expect(await downloadLink(v[k]!, file.id, store)).toContain(file.storageKey);
    await expect(downloadLink(v.st2!, file.id, store)).rejects.toEqual(new AssignmentError("notFound"));
    await expect(downloadLink(v.bAdmin!, file.id, store)).rejects.toEqual(new AssignmentError("notFound"));
  });

  it("a grant from one pupil can't be used by another", async () => {
    const grant = await upload(v.st1!, ids.hw1!);
    await expect(handInFor("st2", ids.hw1!, ids.chi!, { grants: [grant] })).rejects.toEqual(new AssignmentError("badFile"));
  });

  it("the school's storage share is enforced", async () => {
    const before = process.env.STORAGE_QUOTA_MB_PER_SCHOOL;
    process.env.STORAGE_QUOTA_MB_PER_SCHOOL = "0.00001"; // ~10 bytes
    try {
      await expect(requestUpload(v.st1!, { assignmentId: ids.hw1!, kind: "submission", fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 100 }, store)).rejects.toEqual(new AssignmentError("quotaFull"));
    } finally {
      if (before === undefined) delete process.env.STORAGE_QUOTA_MB_PER_SCHOOL;
      else process.env.STORAGE_QUOTA_MB_PER_SCHOOL = before;
    }
  });
});

describe("marking", () => {
  it("only the subject teacher (or an admin) marks; scores must fit", async () => {
    const sheet = (await markingSheet(v.t1!, ids.hw1!))!;
    expect(sheet.map((r) => [r.student.name, r.state])).toEqual([
      ["Ada Pupil", "submitted"],
      ["Chi Pupil", "late"],
    ]);
    const ada = sheet[0]!.submission!.id;
    await expect(markSubmission(v.t2!, ada, { score: 8, feedback: null }, meta)).rejects.toEqual(new AssignmentError("notAllowed")); // form teacher
    await expect(markSubmission(v.st1!, ada, { score: 10, feedback: null }, meta)).rejects.toEqual(new AssignmentError("notAllowed"));
    await expect(markSubmission(v.bAdmin!, ada, { score: 8, feedback: null }, meta)).rejects.toEqual(new AssignmentError("notFound"));
    await expect(markSubmission(v.t1!, ada, { score: 11, feedback: null }, meta)).rejects.toEqual(new AssignmentError("badScore"));
    await expect(markSubmission(v.t1!, ada, { score: null, feedback: "ok" }, meta)).rejects.toEqual(new AssignmentError("badScore")); // scored work needs a score
    await markSubmission(v.t1!, ada, { score: 8.5, feedback: "Good work" }, meta);
    expect(await markingSheet(v.st1!, ids.hw1!)).toBeNull();
  });

  it("families don't see the score until marks are released; marked work can't be handed in again", async () => {
    let view = (await familySubmissions(v.st1!, ids.hw1!))![0]!;
    expect(view).toMatchObject({ mayHandIn: false, submission: { status: "MARKED", score: null, feedback: null } });
    await expect(handInFor("st1", ids.hw1!, ids.ada!)).rejects.toEqual(new AssignmentError("alreadyMarked"));
    const r = await releaseMarks(v.t1!, ids.hw1!, true, meta);
    expect(r.studentIds).toEqual([ids.ada]);
    view = (await familySubmissions(v.p1!, ids.hw1!))![0]!;
    expect(view.submission).toMatchObject({ score: 8.5, feedback: "Good work" });
    const listed = (await listForFamily(v.p1!)).flatMap((c) => c.assignments).find((x) => x.id === ids.hw1)!;
    expect(listed.submission).toMatchObject({ status: "MARKED", score: 8.5 });
    expect((await releaseMarks(v.t1!, ids.hw1!, true, meta)).studentIds).toEqual([]); // already released: nobody told twice
  });

  it("returning work shows the comment straight away and lets the pupil try again", async () => {
    const chi = (await markingSheet(v.t1!, ids.hw1!))!.find((r) => r.student.id === ids.chi)!.submission!.id;
    await expect(returnSubmission(v.t1!, chi, "  ", meta)).rejects.toEqual(new AssignmentError("feedbackNeeded"));
    await returnSubmission(v.t1!, chi, "Show your working for Q3", meta);
    const view = (await familySubmissions(v.st2!, ids.hw1!))![0]!;
    expect(view).toMatchObject({ mayHandIn: true, submission: { status: "RETURNED", feedback: "Show your working for Q3", score: null } });
    await handInFor("st2", ids.hw1!, ids.chi!, { text: "with working" });
    expect((await prisma.assignmentSubmission.findFirstOrThrow({ where: { id: chi } })).status).toBe("SUBMITTED");
  });

  it("paper work is recorded by the teacher with a mark", async () => {
    await recordWork(v.t1!, ids.paper!, ids.ada!, { score: 7, feedback: "Neat" }, meta);
    await expect(recordWork(v.t1!, ids.paper!, ids.bola!, { score: 7, feedback: null }, meta)).rejects.toEqual(new AssignmentError("notFound")); // not in that class
    await expect(recordWork(v.t2!, ids.paper!, ids.chi!, { score: 7, feedback: null }, meta)).rejects.toEqual(new AssignmentError("notAllowed"));
    const row = (await markingSheet(v.t1!, ids.paper!))!.find((r) => r.student.id === ids.ada)!;
    expect(row).toMatchObject({ state: "marked", submission: { score: 7, submittedBy: "STAFF" } });
  });

  it("'not handed in' only after the due date, only for pupils with nothing, and it can be undone by returning", async () => {
    await expect(markMissing(v.t1!, ids.paper!, meta)).rejects.toEqual(new AssignmentError("notYetDue"));
    const n = await markMissing(v.t1!, ids.paper!, meta, new Date(Date.now() + 4 * DAY));
    expect(n).toBe(1); // Chi (Ada's was recorded)
    const chi = (await markingSheet(v.t1!, ids.paper!))!.find((r) => r.student.id === ids.chi)!;
    expect(chi).toMatchObject({ state: "notHandedIn", submission: { score: 0 } });
    expect(await markMissing(v.t1!, ids.paper!, meta, new Date(Date.now() + 4 * DAY))).toBe(0);
    await returnSubmission(v.t1!, chi.submission!.id, "You can still hand this in", meta);
    expect((await prisma.assignmentSubmission.findFirstOrThrow({ where: { id: chi.submission!.id } })).isMissing).toBe(false);
  });

  it("the database won't keep a 'not handed in' record that isn't marked", async () => {
    const sub = await prisma.assignmentSubmission.findFirstOrThrow({ where: { assignmentId: ids.hw2, studentId: ids.bola } });
    await expect(prisma.assignmentSubmission.update({ where: { id: sub.id }, data: { isMissing: true } })).rejects.toThrow();
  });

  it("every change is in the audit log", async () => {
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "AssignmentSubmission" } })).toBeGreaterThanOrEqual(10);
  });
});

describe("abandoned uploads", () => {
  it("an upload never attached is deleted after a day; attached ones never are", async () => {
    const slot = await requestUpload(v.st2!, { assignmentId: ids.hw1!, kind: "submission", fileName: "lost.jpg", contentType: "image/jpeg", sizeBytes: JPEG.length }, store);
    store.put(slot.uploadUrl, JPEG);
    const key = slot.uploadUrl.replace("memory://upload/", "");
    expect(await cleanAbandonedUploads(store, new Date())).toBe(0); // too fresh
    const removed = await cleanAbandonedUploads(store, new Date(Date.now() + 2 * DAY));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(store.objects.has(key)).toBe(false);
    expect(await prisma.pendingUpload.count({ where: { storageKey: key } })).toBe(0);
    const attached = await prisma.assignmentFile.findMany({ where: { tenantId: A } });
    for (const f of attached) expect(store.removed.filter((k) => k === f.storageKey)).toEqual([]);
  });

  it("a pending upload can't point into another school's folder", async () => {
    await expect(prisma.pendingUpload.create({ data: { tenantId: A, storageKey: `${B}/x/submission/y.jpg` } })).rejects.toThrow();
  });
});
