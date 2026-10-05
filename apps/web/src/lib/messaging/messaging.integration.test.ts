import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant, prisma, withRls } from "@educore/db";
import {
  announcementWhere,
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  listThreads,
  MessagingError,
  openThread,
  recipientsFor,
  reply,
  startThread,
  unreadThreadCount,
  updateAnnouncement,
  viewerFor,
  type FullViewer,
} from "./data";
import { announcementVisibleTo } from "./rules";

/**
 * Announcements and teacher–parent messaging against a real Postgres
 * (migrations through 0021): audiences, who may post and edit, who may write
 * to whom, unread counts, admins' safeguarding view, messages that can't be
 * changed, and school-to-school isolation.
 */

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
let A: string;
let B: string;
const ids: Record<string, string> = {};
const v: Record<string, FullViewer> = {};

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "TEACHER" | "PARENT" | "ACCOUNTANT" | "STUDENT") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@msg.test`, name: key, role } })).id;
  return ids[key]!;
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Msg A", slug: `msg-a-${stamp}`, subdomain: `msg-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Msg B", slug: `msg-b-${stamp}`, subdomain: `msg-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  const [jss1, jss2] = await Promise.all(["JSS1", "JSS2"].map((name) => prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name } })));
  ids.jss1 = jss1!.id;
  ids.jss2 = jss2!.id;
  await Promise.all([user(A, "admin", "SCHOOL_ADMIN"), user(A, "t1", "TEACHER"), user(A, "t2", "TEACHER"), user(A, "p1", "PARENT"), user(A, "p2", "PARENT"), user(A, "bursar", "ACCOUNTANT"), user(B, "bAdmin", "SCHOOL_ADMIN")]);
  const [t1, t2] = await Promise.all([
    prisma.teacher.create({ data: { tenantId: A, userId: ids.t1!, employeeId: `T1-${stamp}` } }),
    prisma.teacher.create({ data: { tenantId: A, userId: ids.t2!, employeeId: `T2-${stamp}` } }),
  ]);
  const s1a = await prisma.section.create({ data: { tenantId: A, classId: ids.jss1!, name: "A" } });
  const s2a = await prisma.section.create({ data: { tenantId: A, classId: ids.jss2!, name: "A", formTeacherId: t2.id } });
  const maths = await prisma.subject.create({ data: { tenantId: A, name: "Mathematics", code: `MTH${stamp}`.slice(0, 12) } });
  await prisma.classSectionSubject.create({ data: { tenantId: A, sectionId: s1a.id, subjectId: maths.id, teacherId: t1.id } });
  const mk = (n: string, classId: string, sectionId: string) =>
    prisma.student.create({ data: { tenantId: A, admissionNo: `M-${stamp}-${n}`, firstName: n, lastName: "Pupil", academicYearId: year.id, classId, sectionId } });
  const [st1, st2] = await Promise.all([mk("Ada", ids.jss1!, s1a.id), mk("Bola", ids.jss2!, s2a.id)]);
  ids.s1 = st1.id;
  ids.s2 = st2.id;
  for (const [p, s] of [["p1", st1.id], ["p2", st2.id]] as const) {
    const g = await prisma.guardian.create({ data: { tenantId: A, userId: ids[p]! } });
    await prisma.studentGuardian.create({ data: { tenantId: A, studentId: s, guardianId: g.id, relationship: "MOTHER" } });
  }
  for (const [k, role] of [["admin", "SCHOOL_ADMIN"], ["t1", "TEACHER"], ["t2", "TEACHER"], ["p1", "PARENT"], ["p2", "PARENT"], ["bursar", "ACCOUNTANT"]] as const) {
    v[k] = await viewerFor(A, { id: ids[k]!, role });
  }
  v.bAdmin = await viewerFor(B, { id: ids.bAdmin!, role: "SCHOOL_ADMIN" });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined); // audit log is append-only
  await prisma.$disconnect();
});

describe("who belongs where", () => {
  it("teachers, parents and others get the right classes", () => {
    expect(v.t1!.classIds).toEqual([ids.jss1]);
    expect(v.t2!.classIds).toEqual([ids.jss2]); // form teacher
    expect(v.p1).toMatchObject({ classIds: [ids.jss1], studentIds: [ids.s1] });
    expect(v.bursar!.classIds).toEqual([]);
  });
});

describe("announcements", () => {
  let schoolWide: string;
  let toJss1: string;

  it("admins post to the school (pinned); teachers only to classes they teach", async () => {
    schoolWide = (await createAnnouncement(v.admin!, { title: "Resumption", body: "School resumes Monday.", audienceScope: "SCHOOL", audienceClassId: null, audienceRole: null, isPinned: true }, meta)).id;
    toJss1 = (await createAnnouncement(v.t1!, { title: "Maths test", body: "Friday.", audienceScope: "CLASS", audienceClassId: ids.jss1!, audienceRole: null, isPinned: false }, meta)).id;
    await createAnnouncement(v.admin!, { title: "Parents' meeting", body: "Saturday.", audienceScope: "ROLE", audienceClassId: null, audienceRole: "PARENT", isPinned: false }, meta);
    await expect(createAnnouncement(v.t1!, { title: "x", body: "y", audienceScope: "CLASS", audienceClassId: ids.jss2!, audienceRole: null, isPinned: false }, meta)).rejects.toEqual(new MessagingError("classNotTaught"));
    await expect(createAnnouncement(v.t1!, { title: "x", body: "y", audienceScope: "SCHOOL", audienceClassId: null, audienceRole: null, isPinned: false }, meta)).rejects.toEqual(new MessagingError("classNotTaught"));
    await expect(createAnnouncement(v.p1!, { title: "x", body: "y", audienceScope: "SCHOOL", audienceClassId: null, audienceRole: null, isPinned: false }, meta)).rejects.toEqual(new MessagingError("notAllowed"));
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "Announcement", action: "CREATE" } })).toBe(3);
  });

  it("each person sees exactly their audience, pinned first", async () => {
    const titles = async (k: string) => (await listAnnouncements(v[k]!)).rows.map((r) => r.title);
    expect(await titles("p1")).toEqual(["Resumption", "Parents' meeting", "Maths test"]);
    expect(await titles("p2")).toEqual(["Resumption", "Parents' meeting"]);
    expect(await titles("t2")).toEqual(["Resumption"]);
    expect(await titles("bursar")).toEqual(["Resumption"]);
    expect((await titles("admin")).length).toBe(3);
    expect(await titles("bAdmin")).toEqual([]); // another school
  });

  it("the database query agrees with the rule, for everyone", async () => {
    const all = await prisma.announcement.findMany({ where: { tenantId: A } });
    for (const k of ["admin", "t1", "t2", "p1", "p2", "bursar"]) {
      const viaRule = all.filter((a) => announcementVisibleTo(a, v[k]!)).map((a) => a.id).sort();
      const viaQuery = (await withRls(A, (tx) => tx.announcement.findMany({ where: { tenantId: A, ...announcementWhere(v[k]!) } }))).map((a) => a.id).sort();
      expect(viaQuery).toEqual(viaRule);
    }
  });

  it("teachers edit only their own and never delete; admins can", async () => {
    await updateAnnouncement(v.t1!, toJss1, { title: "Maths test moved", body: "Now Thursday.", audienceScope: "CLASS", audienceClassId: ids.jss1!, audienceRole: null, isPinned: false }, meta);
    await expect(updateAnnouncement(v.t1!, schoolWide, { title: "x", body: "y", audienceScope: "SCHOOL", audienceClassId: null, audienceRole: null, isPinned: false }, meta)).rejects.toEqual(new MessagingError("notAllowed"));
    await expect(deleteAnnouncement(v.t1!, toJss1, meta)).rejects.toEqual(new MessagingError("notAllowed"));
    await deleteAnnouncement(v.admin!, toJss1, meta);
    expect(await prisma.announcement.count({ where: { id: toJss1 } })).toBe(0);
    await expect(deleteAnnouncement(v.bAdmin!, schoolWide, meta)).rejects.toEqual(new MessagingError("notFound")); // another school's
  });
});

describe("messages", () => {
  let threadId: string;

  it("teachers write to the parents of students they teach — nobody else", async () => {
    expect((await recipientsFor(v.t1!, ids.s1!)).map((r) => r.userId)).toEqual([ids.p1]);
    expect(await recipientsFor(v.t1!, ids.s2!)).toEqual([]);
    expect(await recipientsFor(v.bursar!, ids.s1!)).toEqual([]);
    await expect(startThread(v.t1!, { studentId: ids.s2!, recipientIds: [ids.p2!], subject: "Hi", body: "x" }, meta)).rejects.toEqual(new MessagingError("notFound"));
    await expect(startThread(v.t1!, { studentId: ids.s1!, recipientIds: [ids.p1!, ids.p2!], subject: "Hi", body: "x" }, meta)).rejects.toEqual(new MessagingError("recipientNotAllowed"));
  });

  it("parents write to their child's teachers and the school's admins", async () => {
    const r = await recipientsFor(v.p1!, ids.s1!);
    expect(r.map((x) => [x.userId, x.kind, x.detail])).toEqual(
      expect.arrayContaining([
        [ids.t1, "TEACHER", "Mathematics"],
        [ids.admin, "SCHOOL_ADMIN", null],
      ]),
    );
    expect(r.map((x) => x.userId)).not.toContain(ids.t2); // not this child's teacher
    expect(await recipientsFor(v.p1!, ids.s2!)).toEqual([]); // not their child
  });

  it("a conversation: unread counts, reading, replying", async () => {
    const t0 = new Date("2026-10-05T09:00:00Z");
    const started = await startThread(v.t1!, { studentId: ids.s1!, recipientIds: [ids.p1!], subject: "Homework", body: "Ada hasn't handed in her homework." }, meta, t0);
    threadId = started.threadId;
    expect(started.notify).toEqual([ids.p1]);
    expect(await unreadThreadCount(A, ids.p1!)).toBe(1);
    expect(await unreadThreadCount(A, ids.t1!)).toBe(0);
    expect((await listThreads(v.p1!)).rows[0]).toMatchObject({ subject: "Homework", student: "Ada Pupil", unread: true, others: ["t1"] });

    const opened = await openThread(v.p1!, threadId, new Date("2026-10-05T09:05:00Z"));
    expect(opened?.messages.map((m) => m.body)).toEqual(["Ada hasn't handed in her homework."]);
    expect(await unreadThreadCount(A, ids.p1!)).toBe(0);

    const r = await reply(v.p1!, threadId, "Sorry — she'll bring it tomorrow.", meta, new Date("2026-10-05T09:10:00Z"));
    expect(r.notify).toEqual([ids.t1]);
    expect(await unreadThreadCount(A, ids.t1!)).toBe(1);
    expect(await unreadThreadCount(A, ids.p1!)).toBe(0); // own message
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "MessageThread", entityId: threadId } })).toBe(1);
  });

  it("other parents and teachers can't open it; school admins can, and join visibly by replying", async () => {
    expect(await openThread(v.p2!, threadId)).toBeNull();
    expect(await openThread(v.t2!, threadId)).toBeNull();
    await expect(reply(v.p2!, threadId, "hello", meta)).rejects.toEqual(new MessagingError("notFound"));
    const asAdmin = await openThread(v.admin!, threadId);
    expect(asAdmin).toMatchObject({ participating: false });
    expect((await listThreads(v.admin!)).total).toBe(0);
    expect((await listThreads(v.admin!, { all: true })).total).toBe(1);
    const joined = await reply(v.admin!, threadId, "Thanks both.", meta);
    expect(joined.notify.sort()).toEqual([ids.p1, ids.t1].sort());
    expect((await listThreads(v.admin!)).total).toBe(1);
  });

  it("messages are a permanent record, and another school sees nothing", async () => {
    await expect(withRls(A, (tx) => tx.$executeRaw`UPDATE messages SET body = 'edited' WHERE "threadId" = ${threadId}`)).rejects.toThrow(/permission denied/);
    await expect(withRls(A, (tx) => tx.$executeRaw`DELETE FROM messages WHERE "threadId" = ${threadId}`)).rejects.toThrow(/permission denied/);
    expect(await forTenant(B).messageThread.count()).toBe(0);
    expect(await forTenant(B).message.count()).toBe(0);
    expect(await openThread(v.bAdmin!, threadId)).toBeNull();
    expect(await recipientsFor(v.bAdmin!, ids.s1!)).toEqual([]);
    await expect(reply(v.bAdmin!, threadId, "x", meta)).rejects.toEqual(new MessagingError("notFound"));
  });
});
