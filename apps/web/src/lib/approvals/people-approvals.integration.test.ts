import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import { cancelLeave, leaveCalendar, myLeave, saveLeaveType } from "../leave/data";
import { ApprovalError, approvalRequired, decide, requestApproval, withdraw, type Actor } from "./engine";
import { saveProcessPolicy } from "./settings";

/**
 * People and communication (Phase 8.2) against a real Postgres (migrations
 * through 0035): a pupil only leaves the roll once approved; a teacher's
 * school-wide announcement only goes out once approved; staff leave is
 * always a request, kept within balances, booked on approval, and cancelled
 * back into the balance; schools never see or decide each other's.
 */

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
let A: string;
let B: string;
const ids: Record<string, string> = {};
const act: Record<string, Actor> = {};

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "ACCOUNTANT" | "TEACHER" | "SCHOOL_NURSE") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@people-approvals.test`, name: key, role } })).id;
  act[key] = { tenantId, userId: ids[key]!, role, impersonating: false };
}
const approve = (who: string, id: string) => decide(act[who]!, id, { decision: "APPROVE", comment: "", expectedStep: 1 }, meta);
const audit = (who: string) => ({ tenantId: act[who]!.tenantId, actorId: ids[who]!, ipAddress: null, userAgent: null });

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "People A", slug: `pa-a-${stamp}`, subdomain: `pa-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "People B", slug: `pa-b-${stamp}`, subdomain: `pa-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  ids.year = (await prisma.academicYear.create({ data: { tenantId: A, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } })).id;
  ids.pupil = (await prisma.student.create({ data: { tenantId: A, admissionNo: `PA-${stamp}`, firstName: "Tobi", lastName: "Ade", academicYearId: ids.year } })).id;
  await Promise.all([user(A, "head", "SCHOOL_ADMIN"), user(A, "admin2", "SCHOOL_ADMIN"), user(A, "bursar", "ACCOUNTANT"), user(A, "teacher", "TEACHER"), user(A, "nurse", "SCHOOL_NURSE"), user(B, "bAdmin", "SCHOOL_ADMIN")]);
  act.support = { ...act.head!, impersonating: true };
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("a pupil leaving the roll", () => {
  it("waits for another admin; a bursar can't approve; on approval the pupil leaves and the date is kept", async () => {
    expect(await approvalRequired(A, "STUDENT_STATUS")).toBe(false);
    await saveProcessPolicy(act.head!, "STUDENT_STATUS", { enabled: true, step1: { roles: ["SCHOOL_ADMIN", "ACCOUNTANT"], userIds: [] } }, meta);
    const r = await requestApproval(act.admin2!, "STUDENT_STATUS", { studentId: ids.pupil, status: "WITHDRAWN" }, "", meta);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: ids.pupil } })).status).toBe("ACTIVE");
    await expect(approve("bursar", r.id)).rejects.toEqual(new ApprovalError("notAllowed"));
    await expect(approve("bAdmin", r.id)).rejects.toEqual(new ApprovalError("notFound"));
    expect(await approve("head", r.id)).toEqual({ outcome: "approved" });
    const st = await prisma.student.findUniqueOrThrow({ where: { id: ids.pupil } });
    expect(st.status).toBe("WITHDRAWN");
    expect(st.leftAt).not.toBeNull(); // starts the health-record retention clock (Phase 7.2)
  });

  it("a request for a status the pupil already has is refused, and a stale one fails safely", async () => {
    await expect(requestApproval(act.admin2!, "STUDENT_STATUS", { studentId: ids.pupil, status: "WITHDRAWN" }, "", meta)).rejects.toMatchObject({ code: "student.unchanged" });
    const r = await requestApproval(act.admin2!, "STUDENT_STATUS", { studentId: ids.pupil, status: "GRADUATED" }, "", meta);
    await prisma.student.update({ where: { id: ids.pupil }, data: { status: "GRADUATED" } });
    expect(await approve("head", r.id)).toEqual({ outcome: "failed", code: "student.unchanged" });
  });
});

describe("a teacher's school-wide announcement", () => {
  it("is off until switched on; when on, nothing goes out until an admin approves it, then it's from the teacher", async () => {
    expect(await approvalRequired(A, "ANNOUNCEMENT_SCHOOL")).toBe(false);
    await saveProcessPolicy(act.head!, "ANNOUNCEMENT_SCHOOL", { enabled: true }, meta);
    const input = { title: "Inter-house sports", body: "Sports day is on Friday. Wear house colours.", audienceScope: "SCHOOL", audienceClassId: null, audienceRole: null, isPinned: false };
    const r = await requestApproval(act.teacher!, "ANNOUNCEMENT_SCHOOL", input, "", meta);
    expect(await prisma.announcement.count({ where: { tenantId: A } })).toBe(0);
    const row = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.summary).toMatchObject({ title: "Inter-house sports", body: "Sports day is on Friday. Wear house colours.", audience: "SCHOOL" });
    expect(await approve("head", r.id)).toEqual({ outcome: "approved" });
    const ann = await prisma.announcement.findFirstOrThrow({ where: { tenantId: A } });
    expect(ann).toMatchObject({ title: "Inter-house sports", audienceScope: "SCHOOL", publishedById: ids.teacher, isPinned: false });
  });

  it("can't be used to pin, or to post to a class", async () => {
    await expect(requestApproval(act.teacher!, "ANNOUNCEMENT_SCHOOL", { title: "x", body: "y", audienceScope: "SCHOOL", isPinned: true }, "", meta)).rejects.toThrow();
    await expect(requestApproval(act.teacher!, "ANNOUNCEMENT_SCHOOL", { title: "x", body: "y", audienceScope: "CLASS", audienceClassId: "c1" }, "", meta)).rejects.toThrow();
  });
});

describe("staff leave", () => {
  it("a new school gets default leave types and full balances", async () => {
    const mine = await myLeave(A, ids.teacher!);
    expect(mine.types.map((t) => [t.name, t.balance.left])).toEqual([["Annual leave", 20], ["Sick leave", 12], ["Casual leave", 5], ["Maternity leave", 60], ["Paternity leave", 5]]);
    ids.annual = (await prisma.leaveType.findFirstOrThrow({ where: { tenantId: A, name: "Annual leave" } })).id;
    ids.casual = (await prisma.leaveType.findFirstOrThrow({ where: { tenantId: A, name: "Casual leave" } })).id;
    expect(await approvalRequired(A, "LEAVE")).toBe(false); // the switch is irrelevant: leave is always a request
  });

  it("a request counts as pending against the balance; overlapping or over-balance requests are refused", async () => {
    const r = await requestApproval(act.teacher!, "LEAVE", { leaveTypeId: ids.casual, startDate: "2026-10-19", endDate: "2026-10-21", note: "Family wedding" }, "Family wedding", meta);
    ids.leave1 = r.id;
    expect((await myLeave(A, ids.teacher!)).types.find((t) => t.id === ids.casual)!.balance).toEqual({ allowance: 5, taken: 0, pending: 3, left: 2 });
    await expect(requestApproval(act.teacher!, "LEAVE", { leaveTypeId: ids.annual, startDate: "2026-10-21", endDate: "2026-10-22" }, "", meta)).rejects.toMatchObject({ code: "overlap" });
    await expect(requestApproval(act.teacher!, "LEAVE", { leaveTypeId: ids.casual, startDate: "2026-11-02", endDate: "2026-11-04" }, "", meta)).rejects.toMatchObject({ code: "balance" }); // 3 > 2 left
    await expect(requestApproval(act.teacher!, "LEAVE", { leaveTypeId: ids.casual, startDate: "2026-10-24", endDate: "2026-10-25" }, "", meta)).rejects.toMatchObject({ code: "noWorkingDays" });
    await expect(requestApproval(act.teacher!, "LEAVE", { leaveTypeId: ids.casual, startDate: "2027-08-02", endDate: "2027-08-03" }, "", meta)).rejects.toMatchObject({ code: "outsideYear" });
  });

  it("only another school admin decides: not the person, a bursar, support or another school", async () => {
    await expect(approve("teacher", ids.leave1!)).rejects.toEqual(new ApprovalError("ownRequest"));
    await expect(approve("bursar", ids.leave1!)).rejects.toEqual(new ApprovalError("notAllowed"));
    await expect(approve("nurse", ids.leave1!)).rejects.toEqual(new ApprovalError("notAllowed"));
    await expect(approve("support", ids.leave1!)).rejects.toEqual(new ApprovalError("supportCannotDecide"));
    await expect(approve("bAdmin", ids.leave1!)).rejects.toEqual(new ApprovalError("notFound"));
    expect(await prisma.staffLeave.count({ where: { tenantId: A } })).toBe(0);
  });

  it("approval books it: taken goes up, pending down, and it shows on the calendar", async () => {
    expect(await approve("head", ids.leave1!)).toEqual({ outcome: "approved" });
    const booked = await prisma.staffLeave.findFirstOrThrow({ where: { tenantId: A, userId: ids.teacher } });
    expect(booked).toMatchObject({ days: 3, status: "APPROVED", note: "Family wedding" });
    expect((await myLeave(A, ids.teacher!)).types.find((t) => t.id === ids.casual)!.balance).toEqual({ allowance: 5, taken: 3, pending: 0, left: 2 });
    const cal = await leaveCalendar(A, new Date("2026-10-01T00:00:00Z"));
    expect(cal.entries.map((e) => [e.kind, e.userId, e.startDate])).toEqual([["approved", ids.teacher, "2026-10-19"]]);
    expect((await leaveCalendar(B, new Date("2026-10-01T00:00:00Z"))).entries).toEqual([]);
  });

  it("the requester can withdraw a pending request; an admin can cancel booked leave and the days come back", async () => {
    const r = await requestApproval(act.nurse!, "LEAVE", { leaveTypeId: ids.annual, startDate: "2026-11-09", endDate: "2026-11-13" }, "", meta);
    await expect(withdraw(act.head!, r.id, meta)).rejects.toEqual(new ApprovalError("notFound")); // not theirs to withdraw
    await withdraw(act.nurse!, r.id, meta);
    expect((await myLeave(A, ids.nurse!)).types.find((t) => t.id === ids.annual)!.balance.pending).toBe(0);
    const booked = await prisma.staffLeave.findFirstOrThrow({ where: { tenantId: A, userId: ids.teacher } });
    await cancelLeave(audit("head"), booked.id);
    expect((await myLeave(A, ids.teacher!)).types.find((t) => t.id === ids.casual)!.balance.left).toBe(5);
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "StaffLeave", action: "UPDATE" } })).toBe(1);
  });

  it("an admin's own leave needs a different admin; with only one admin it's refused", async () => {
    const r = await requestApproval(act.head!, "LEAVE", { leaveTypeId: ids.annual, startDate: "2026-12-07", endDate: "2026-12-08" }, "", meta);
    await expect(approve("head", r.id)).rejects.toEqual(new ApprovalError("ownRequest"));
    expect(await approve("admin2", r.id)).toEqual({ outcome: "approved" });
    await withRls(B, (tx) => tx.leaveType.count()); // touch B so it has no types yet
    await prisma.academicYear.create({ data: { tenantId: B, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
    await myLeave(B, ids.bAdmin!);
    const bAnnual = await prisma.leaveType.findFirstOrThrow({ where: { tenantId: B, name: "Annual leave" } });
    await expect(requestApproval(act.bAdmin!, "LEAVE", { leaveTypeId: bAnnual.id, startDate: "2026-12-07", endDate: "2026-12-08" }, "", meta)).rejects.toEqual(new ApprovalError("noApprover"));
  });

  it("leave types are per school; switched-off types can't be requested; another school's type is not found", async () => {
    await saveLeaveType(audit("head"), { id: ids.casual, name: "Casual leave", daysPerYear: 5, isActive: false });
    await expect(requestApproval(act.teacher!, "LEAVE", { leaveTypeId: ids.casual, startDate: "2027-01-11", endDate: "2027-01-11" }, "", meta)).rejects.toMatchObject({ code: "typeInactive" });
    await expect(saveLeaveType(audit("bAdmin"), { id: ids.annual, name: "Hijack", daysPerYear: 99, isActive: true })).rejects.toMatchObject({ code: "notFound" });
    await expect(requestApproval(act.bAdmin!, "LEAVE", { leaveTypeId: ids.annual, startDate: "2027-01-11", endDate: "2027-01-11" }, "", meta)).rejects.toMatchObject({ code: "notFound" });
    expect((await prisma.leaveType.findUniqueOrThrow({ where: { id: ids.annual } })).name).toBe("Annual leave");
  });

  it("the app can't delete leave or leave types (cancelled and switched off instead)", async () => {
    await expect(withRls(A, (tx) => tx.staffLeave.deleteMany({}))).rejects.toThrow();
    await expect(withRls(A, (tx) => tx.leaveType.deleteMany({}))).rejects.toThrow();
  });
});
