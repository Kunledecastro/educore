import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import { unpublishClassResults } from "../results-writer";
import { ApprovalError, approvalRequired, decide, getRequest, requestApproval, type Actor } from "./engine";
import { saveProcessPolicy } from "./settings";

/**
 * Academic approvals (Phase 8.1) against a real Postgres (migrations through
 * 0034): publishing and unpublishing results wait for a second school admin;
 * bursars never approve them, even if named; unpublishing must say why and
 * which subjects; nothing changes before final approval; a stale request
 * fails safely; other schools can't see or decide.
 */

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
let A: string;
let B: string;
const ids: Record<string, string> = {};
const act: Record<string, Actor> = {};

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "ACCOUNTANT" | "TEACHER") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@results-approvals.test`, name: key, role } })).id;
  act[key] = { tenantId, userId: ids[key]!, role, impersonating: false };
}
const published = async () => Boolean(await prisma.resultPublication.findFirst({ where: { tenantId: A, classId: ids.cls, termId: ids.term } }));
const approve = (who: string, id: string) => decide(act[who]!, id, { decision: "APPROVE", comment: "", expectedStep: 1 }, meta);

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Results A", slug: `ra-a-${stamp}`, subdomain: `ra-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Results B", slug: `ra-b-${stamp}`, subdomain: `ra-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  ids.year = year.id;
  ids.term = (await prisma.term.create({ data: { tenantId: A, academicYearId: year.id, name: "First", order: 1, startDate: new Date("2026-09-07"), endDate: new Date("2026-12-18"), isCurrent: true } })).id;
  ids.cls = (await prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name: "JSS 2" } })).id;
  ids.maths = (await prisma.subject.create({ data: { tenantId: A, name: "Mathematics", code: `M${stamp % 1000}` } })).id;
  ids.english = (await prisma.subject.create({ data: { tenantId: A, name: "English", code: `E${stamp % 1000}` } })).id;
  ids.pupil = (await prisma.student.create({ data: { tenantId: A, admissionNo: `RA-${stamp}`, firstName: "Ada", lastName: "Obi", classId: ids.cls, academicYearId: year.id } })).id;
  await Promise.all([user(A, "head", "SCHOOL_ADMIN"), user(A, "admin2", "SCHOOL_ADMIN"), user(A, "bursar", "ACCOUNTANT"), user(A, "teacher", "TEACHER"), user(B, "bAdmin", "SCHOOL_ADMIN")]);
  act.support = { ...act.head!, impersonating: true };
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("settings", () => {
  it("off by default; only school admins can be approvers for results — a named bursar is refused and the bursar role is dropped", async () => {
    expect(await approvalRequired(A, "RESULTS_PUBLISH")).toBe(false);
    expect(await approvalRequired(A, "RESULTS_UNPUBLISH")).toBe(false);
    await expect(saveProcessPolicy(act.head!, "RESULTS_PUBLISH", { enabled: true, step1: { roles: [], userIds: [ids.bursar!] } }, meta)).rejects.toEqual(new ApprovalError("notAllowed"));
    const saved = await saveProcessPolicy(act.head!, "RESULTS_PUBLISH", { enabled: true, step1: { roles: ["SCHOOL_ADMIN", "ACCOUNTANT"], userIds: [] }, step2: { roles: ["SCHOOL_ADMIN"], userIds: [] }, secondStepFromMinor: 0 }, meta);
    expect(saved.step1.roles).toEqual(["SCHOOL_ADMIN"]);
    expect(saved.step2).toBeNull(); // no amount, so no second step by amount
    await saveProcessPolicy(act.head!, "RESULTS_UNPUBLISH", { enabled: true, step1: { roles: [], userIds: [ids.head!] } }, meta);
    expect(await approvalRequired(A, "RESULTS_PUBLISH")).toBe(true);
    expect(await approvalRequired(B, "RESULTS_PUBLISH")).toBe(false);
  });
});

describe("publishing", () => {
  it("is held as a request; nothing is published yet", async () => {
    const r = await requestApproval(act.admin2!, "RESULTS_PUBLISH", { classId: ids.cls, termId: ids.term, note: "All scores in" }, "All scores in", meta);
    ids.pub = r.id;
    expect(r.approverIds).toEqual([ids.head]);
    expect(await published()).toBe(false);
    await expect(requestApproval(act.admin2!, "RESULTS_PUBLISH", { classId: ids.cls, termId: ids.term }, "", meta)).rejects.toEqual(new ApprovalError("alreadyPending"));
  });

  it("bursars, teachers, the requester, support and other schools can't approve", async () => {
    await expect(approve("bursar", ids.pub!)).rejects.toEqual(new ApprovalError("notAllowed"));
    await expect(approve("teacher", ids.pub!)).rejects.toEqual(new ApprovalError("notAllowed"));
    await expect(approve("admin2", ids.pub!)).rejects.toEqual(new ApprovalError("ownRequest"));
    await expect(approve("support", ids.pub!)).rejects.toEqual(new ApprovalError("supportCannotDecide"));
    await expect(approve("bAdmin", ids.pub!)).rejects.toEqual(new ApprovalError("notFound"));
    expect(await getRequest(act.bAdmin!, ids.pub!)).toBeNull();
    expect(await getRequest(act.bursar!, ids.pub!)).toBeNull(); // not theirs to see either
    expect(await published()).toBe(false);
  });

  it("the head's approval publishes, credited to the admin who asked", async () => {
    expect(await approve("head", ids.pub!)).toEqual({ outcome: "approved" });
    const pub = await prisma.resultPublication.findFirstOrThrow({ where: { tenantId: A, classId: ids.cls, termId: ids.term } });
    expect(pub.publishedById).toBe(ids.admin2);
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "ResultPublication", action: "CREATE", actorId: ids.admin2 } })).toBe(1);
  });
});

describe("unpublishing to change marks", () => {
  it("must say why and which subjects; subjects must be this school's", async () => {
    await expect(requestApproval(act.admin2!, "RESULTS_UNPUBLISH", { classId: ids.cls, termId: ids.term, reason: "", subjectIds: [ids.maths] }, "", meta)).rejects.toThrow();
    await expect(requestApproval(act.admin2!, "RESULTS_UNPUBLISH", { classId: ids.cls, termId: ids.term, reason: "Wrong scores", subjectIds: [] }, "", meta)).rejects.toThrow();
    const bSubject = await prisma.subject.create({ data: { tenantId: B, name: "B maths", code: `BM${stamp % 1000}` } });
    await expect(requestApproval(act.admin2!, "RESULTS_UNPUBLISH", { classId: ids.cls, termId: ids.term, reason: "Wrong scores", subjectIds: [bSubject.id] }, "", meta)).rejects.toThrow();
    expect(await prisma.approvalRequest.count({ where: { tenantId: A, process: "RESULTS_UNPUBLISH" } })).toBe(0);
  });

  it("is held as a request with the reason and subjects; results stay published until approved", async () => {
    await prisma.reportCard.create({ data: { tenantId: A, studentId: ids.pupil!, academicYearId: ids.year!, termId: ids.term!, status: "READY", generatedAt: new Date() } });
    const r = await requestApproval(act.admin2!, "RESULTS_UNPUBLISH", { classId: ids.cls, termId: ids.term, reason: "Two maths scores swapped", subjectIds: [ids.maths, ids.english] }, "Two maths scores swapped", meta);
    ids.unpub = r.id;
    const row = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.summary).toMatchObject({ className: "JSS 2", termName: "First", subjects: "English, Mathematics", reason: "Two maths scores swapped" });
    expect(row.amountMinor).toBeNull();
    expect(await published()).toBe(true);
  });

  it("approval takes them down and sends the report cards back for regeneration", async () => {
    expect(await approve("head", ids.unpub!)).toEqual({ outcome: "approved" });
    expect(await published()).toBe(false);
    expect((await prisma.reportCard.findFirstOrThrow({ where: { tenantId: A, studentId: ids.pupil } })).status).toBe("PENDING");
  });

  it("a stale request fails safely: nothing else changes", async () => {
    // Published again, a request to take them down, then someone does it directly first.
    await prisma.resultPublication.create({ data: { tenantId: A, classId: ids.cls!, termId: ids.term!, publishedById: ids.head } });
    const r = await requestApproval(act.admin2!, "RESULTS_UNPUBLISH", { classId: ids.cls, termId: ids.term, reason: "Again", subjectIds: [ids.english] }, "Again", meta);
    await withRls(A, (tx) => unpublishClassResults(tx, { tenantId: A, actorId: ids.head! }, { classId: ids.cls!, termId: ids.term! }));
    expect(await approve("head", r.id)).toEqual({ outcome: "failed", code: "results.notPublished" });
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("FAILED");
    expect(await published()).toBe(false);
  });
});

describe("plans", () => {
  it("a plan without approvals never holds actions for approval, whatever the settings say", async () => {
    await prisma.tenant.update({ where: { id: A }, data: { plan: "STARTER" } });
    expect(await approvalRequired(A, "RESULTS_PUBLISH")).toBe(false);
    await prisma.tenant.update({ where: { id: A }, data: { plan: "FREE_TRIAL" } });
    expect(await approvalRequired(A, "RESULTS_PUBLISH")).toBe(true);
  });
});
