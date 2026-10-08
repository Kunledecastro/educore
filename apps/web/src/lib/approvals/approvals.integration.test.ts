import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant, prisma, withRls } from "@educore/db";
import { billsFor } from "../fees-data";
import { assignStudentDiscount } from "../discount-writer";
import { createInvoice, recordPayment } from "../invoice-writer";
import { ApprovalError, approvalRequired, decide, getRequest, listRequests, requestApproval, sweep, withdraw, type Actor } from "./engine";
import { saveProcessPolicy } from "./settings";

/**
 * Approval workflows (Phase 8.0) against a real Postgres (migrations through
 * 0032): nothing changes before the final approval; it applies exactly once
 * (even with two approvers at once); rejection, withdrawal and expiry leave
 * the school's data untouched; a stale request fails safely; nobody approves
 * their own request or two steps; support sign-ins can't decide; schools
 * can't see or decide each other's requests.
 */

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
let A: string;
let B: string;
const ids: Record<string, string> = {};
const act: Record<string, Actor> = {};
let term: { id: string; academicYearId: string; yearStart: Date };

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "ACCOUNTANT" | "TEACHER") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@approvals.test`, name: key, role } })).id;
  act[key] = { tenantId, userId: ids[key]!, role, impersonating: false };
}

async function invoiceFor(studentId: string) {
  const bills = await billsFor(forTenant(A), term, [studentId]);
  return withRls(A, (tx) => createInvoice(tx, { tenantId: A, actorId: null }, { studentId, term, bill: bills.get(studentId)!, dueDate: new Date("2026-09-30"), currency: "NGN", prefix: `AP${stamp % 1000}` }));
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Approvals A", slug: `ap-a-${stamp}`, subdomain: `ap-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Approvals B", slug: `ap-b-${stamp}`, subdomain: `ap-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  const t1 = await prisma.term.create({ data: { tenantId: A, academicYearId: year.id, name: "First", order: 1, startDate: new Date("2026-09-07"), endDate: new Date("2026-12-18"), isCurrent: true } });
  term = { id: t1.id, academicYearId: year.id, yearStart: year.startDate };
  ids.year = year.id;
  const cls = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name: "Grade 5", order: 1 } });
  const section = await prisma.section.create({ data: { tenantId: A, classId: cls.id, name: "A" } });
  for (let i = 0; i < 4; i++) {
    const s = await prisma.student.create({ data: { tenantId: A, admissionNo: `AP-${stamp}-${i}`, firstName: `Pupil${i}`, lastName: "Test", classId: cls.id, sectionId: section.id, academicYearId: year.id } });
    ids[`s${i}`] = s.id;
  }
  const tuition = await prisma.feeType.create({ data: { tenantId: A, name: "Tuition", order: 1 } });
  await prisma.feeStructure.create({ data: { tenantId: A, academicYearId: year.id, termId: t1.id, classId: cls.id, feeTypeId: tuition.id, amount: "150000.00" } });
  ids.sibling = (await prisma.discount.create({ data: { tenantId: A, name: "Sibling", kind: "PERCENT", value: "10.00", feeTypeId: tuition.id } })).id;
  await Promise.all([user(A, "proprietor", "SCHOOL_ADMIN"), user(A, "admin2", "SCHOOL_ADMIN"), user(A, "bursar", "ACCOUNTANT"), user(A, "bursar2", "ACCOUNTANT"), user(A, "teacher", "TEACHER"), user(B, "bAdmin", "SCHOOL_ADMIN")]);
  act.support = { ...act.admin2!, impersonating: true };
  ids.inv0 = (await invoiceFor(ids.s0!)).id;
  ids.inv1 = (await invoiceFor(ids.s1!)).id;
  ids.inv2 = (await invoiceFor(ids.s2!)).id;
  const paid = await withRls(A, (tx) => recordPayment(tx, { tenantId: A, actorId: ids.bursar! }, { invoiceId: ids.inv1!, amountMinor: 5_000_000, method: "CASH", reference: null, note: null, paidAt: new Date("2026-10-01"), today: new Date("2026-10-08"), receiptPrefix: "RC" }));
  ids.pay1 = paid.payment.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

const invoiceStatus = async (id: string) => (await prisma.invoice.findUniqueOrThrow({ where: { id } })).status;

describe("policies", () => {
  it("everything is off until the school switches it on; only a real school admin changes the settings", async () => {
    expect(await approvalRequired(A, "INVOICE_CANCEL")).toBe(false);
    await expect(saveProcessPolicy(act.bursar!, "INVOICE_CANCEL", { enabled: true }, meta)).rejects.toEqual(new ApprovalError("notAllowed"));
    await expect(saveProcessPolicy(act.support!, "INVOICE_CANCEL", { enabled: true }, meta)).rejects.toEqual(new ApprovalError("notAllowed"));
    await expect(saveProcessPolicy(act.proprietor!, "INVOICE_CANCEL", { enabled: true, step1: { roles: [], userIds: [ids.teacher!] } }, meta)).rejects.toEqual(new ApprovalError("notAllowed"));
    // Cancellations: any admin, then the proprietor from ₦100,000.
    await saveProcessPolicy(act.proprietor!, "INVOICE_CANCEL", { enabled: true, step1: { roles: ["SCHOOL_ADMIN"], userIds: [] }, step2: { roles: [], userIds: [ids.proprietor!] }, secondStepFromMinor: 10_000_000 }, meta);
    await saveProcessPolicy(act.proprietor!, "PAYMENT_REVERSAL", { enabled: true, step1: { roles: ["SCHOOL_ADMIN"], userIds: [] } }, meta);
    await saveProcessPolicy(act.proprietor!, "DISCOUNT_ASSIGN", { enabled: true, step1: { roles: [], userIds: [ids.proprietor!, ids.bursar2!] } }, meta);
    expect(await approvalRequired(A, "INVOICE_CANCEL")).toBe(true);
    expect(await approvalRequired(B, "INVOICE_CANCEL")).toBe(false);
  });
});

describe("a two-step invoice cancellation", () => {
  it("is held as a request: the invoice doesn't change, and a second request for it is refused", async () => {
    const r = await requestApproval(act.bursar!, "INVOICE_CANCEL", { invoiceId: ids.inv0, reason: "Duplicate bill" }, "Duplicate bill", meta);
    ids.req0 = r.id;
    expect(r.approverIds.sort()).toEqual([ids.proprietor, ids.admin2].sort());
    expect(await invoiceStatus(ids.inv0!)).not.toBe("CANCELLED");
    const row = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: "PENDING", stepsRequired: 2, currentStep: 1, amountMinor: BigInt(15_000_000) });
    await expect(requestApproval(act.bursar2!, "INVOICE_CANCEL", { invoiceId: ids.inv0, reason: "Again" }, "", meta)).rejects.toEqual(new ApprovalError("alreadyPending"));
    // An admin asking would leave only the proprietor for both steps: two different people are needed.
    await expect(requestApproval(act.admin2!, "INVOICE_CANCEL", { invoiceId: ids.inv2, reason: "x" }, "", meta)).rejects.toEqual(new ApprovalError("noApprover"));
  });

  it("nobody approves their own request; teachers, support and other schools can't decide", async () => {
    const d = { decision: "APPROVE" as const, comment: "", expectedStep: 1 };
    await expect(decide(act.bursar!, ids.req0!, d, meta)).rejects.toEqual(new ApprovalError("ownRequest"));
    await expect(decide(act.teacher!, ids.req0!, d, meta)).rejects.toEqual(new ApprovalError("notAllowed"));
    await expect(decide(act.bursar2!, ids.req0!, d, meta)).rejects.toEqual(new ApprovalError("notAllowed")); // bursars aren't step-1 approvers here
    await expect(decide(act.support!, ids.req0!, d, meta)).rejects.toEqual(new ApprovalError("supportCannotDecide"));
    await expect(decide(act.bAdmin!, ids.req0!, d, meta)).rejects.toEqual(new ApprovalError("notFound"));
  });

  it("step 1 moves it on without applying; the same person can't take step 2; a stale screen is refused", async () => {
    const r = await decide(act.admin2!, ids.req0!, { decision: "APPROVE", comment: "Checked", expectedStep: 1 }, meta);
    expect(r).toEqual({ outcome: "nextStep", approverIds: [ids.proprietor] });
    expect(await invoiceStatus(ids.inv0!)).not.toBe("CANCELLED");
    await expect(decide(act.admin2!, ids.req0!, { decision: "APPROVE", comment: "", expectedStep: 2 }, meta)).rejects.toEqual(new ApprovalError("notAllowed"));
    await expect(decide(act.proprietor!, ids.req0!, { decision: "APPROVE", comment: "", expectedStep: 1 }, meta)).rejects.toEqual(new ApprovalError("changed"));
  });

  it("the final approval cancels the invoice once, as the person who asked, with the approval on record", async () => {
    expect(await decide(act.proprietor!, ids.req0!, { decision: "APPROVE", comment: "", expectedStep: 2 }, meta)).toEqual({ outcome: "approved" });
    expect(await invoiceStatus(ids.inv0!)).toBe("CANCELLED");
    const inv = await prisma.auditLog.findFirst({ where: { tenantId: A, entityType: "Invoice", entityId: ids.inv0, action: "UPDATE" }, orderBy: { createdAt: "desc" } });
    expect(inv?.actorId).toBe(ids.bursar);
    const req = await prisma.auditLog.findFirst({ where: { tenantId: A, entityType: "ApprovalRequest", entityId: ids.req0 }, orderBy: { createdAt: "desc" } });
    expect(req?.after).toMatchObject({ status: "APPROVED", approvedBy: ids.proprietor, requestedBy: ids.bursar });
    expect(await prisma.approvalDecision.count({ where: { requestId: ids.req0 } })).toBe(2);
    await expect(decide(act.proprietor!, ids.req0!, { decision: "APPROVE", comment: "", expectedStep: 2 }, meta)).rejects.toEqual(new ApprovalError("notPending"));
  });

  it("decisions can't be rewritten", async () => {
    await expect(prisma.approvalDecision.updateMany({ where: { requestId: ids.req0 }, data: { decision: "REJECT" } })).rejects.toThrow(/append-only/);
  });
});

describe("rejection, withdrawal, expiry and stale requests leave the data untouched", () => {
  it("a rejection needs a reason, and the payment is not reversed", async () => {
    const r = await requestApproval(act.bursar!, "PAYMENT_REVERSAL", { paymentId: ids.pay1, reason: "Bounced transfer" }, "", meta);
    await expect(decide(act.admin2!, r.id, { decision: "REJECT", comment: " ", expectedStep: 1 }, meta)).rejects.toEqual(new ApprovalError("commentRequired"));
    expect(await decide(act.admin2!, r.id, { decision: "REJECT", comment: "The transfer cleared", expectedStep: 1 }, meta)).toEqual({ outcome: "rejected" });
    expect(await prisma.payment.count({ where: { reversesId: ids.pay1 } })).toBe(0);
  });

  it("the requester can withdraw (nobody else can)", async () => {
    const r = await requestApproval(act.bursar!, "PAYMENT_REVERSAL", { paymentId: ids.pay1, reason: "Wrong pupil" }, "", meta);
    await expect(withdraw(act.admin2!, r.id, meta)).rejects.toEqual(new ApprovalError("notFound"));
    await withdraw(act.bursar!, r.id, meta);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("WITHDRAWN");
  });

  it("requests expire; a reminder is due after two days", async () => {
    const r = await requestApproval(act.bursar!, "PAYMENT_REVERSAL", { paymentId: ids.pay1, reason: "Duplicate" }, "", meta);
    const later = await sweep(new Date(Date.now() + 3 * 86_400_000));
    expect(later.remind.map((x) => x.id)).toContain(r.id);
    const out = await sweep(new Date(Date.now() + 8 * 86_400_000));
    expect(out.expired.map((x) => x.id)).toContain(r.id);
    await expect(decide(act.admin2!, r.id, { decision: "APPROVE", comment: "", expectedStep: 1 }, meta)).rejects.toEqual(new ApprovalError("notPending"));
    expect(await prisma.payment.count({ where: { reversesId: ids.pay1 } })).toBe(0);
  });

  it("a request that's no longer possible fails safely: nothing applied, the approval and the reason recorded", async () => {
    const r = await requestApproval(act.bursar!, "INVOICE_CANCEL", { invoiceId: ids.inv2, reason: "Left school" }, "", meta);
    await withRls(A, (tx) => recordPayment(tx, { tenantId: A, actorId: ids.bursar! }, { invoiceId: ids.inv2!, amountMinor: 100_000, method: "CASH", reference: null, note: null, paidAt: new Date("2026-10-02"), today: new Date("2026-10-08"), receiptPrefix: "RC" }));
    expect((await decide(act.admin2!, r.id, { decision: "APPROVE", comment: "", expectedStep: 1 }, meta)).outcome).toBe("nextStep");
    expect(await decide(act.proprietor!, r.id, { decision: "APPROVE", comment: "", expectedStep: 2 }, meta)).toEqual({ outcome: "failed", code: "fee.hasPayments" });
    expect(await invoiceStatus(ids.inv2!)).not.toBe("CANCELLED");
    const row = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id }, include: { decisions: true } });
    expect(row).toMatchObject({ status: "FAILED", failureCode: "fee.hasPayments" });
    expect(row.decisions).toHaveLength(2);
  });
});

describe("discounts", () => {
  it("values a percentage discount against the pupil's fees, and refuses a request nobody else could approve", async () => {
    const r = await requestApproval(act.bursar!, "DISCOUNT_ASSIGN", { studentId: ids.s3, discountId: ids.sibling, academicYearId: ids.year, termId: term.id, note: "Second child" }, "Second child", meta);
    ids.disc = r.id;
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: r.id } })).amountMinor).toBe(BigInt(1_500_000)); // 10% of ₦150,000
    expect(await prisma.studentDiscount.count({ where: { studentId: ids.s3 } })).toBe(0);
    // bursar2 is the only other approver; bursar2 asking leaves only the proprietor — fine; but a policy naming only the requester isn't.
    await saveProcessPolicy(act.proprietor!, "DISCOUNT_RULE", { enabled: true, step1: { roles: [], userIds: [ids.bursar!] } }, meta);
    await expect(requestApproval(act.bursar!, "DISCOUNT_RULE", { id: null, data: { name: "Scholarship", kind: "FIXED", value: "20000", isActive: true } }, "", meta)).rejects.toEqual(new ApprovalError("noApprover"));
  });

  it("two approvers at once: the discount is given exactly once", async () => {
    const results = await Promise.allSettled([
      decide(act.proprietor!, ids.disc!, { decision: "APPROVE", comment: "", expectedStep: 1 }, meta),
      decide(act.bursar2!, ids.disc!, { decision: "APPROVE", comment: "", expectedStep: 1 }, meta),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: new ApprovalError("notPending") });
    expect(await prisma.studentDiscount.count({ where: { studentId: ids.s3 } })).toBe(1);
  });

  it("a discount given meanwhile makes the request fail instead of duplicating it", async () => {
    const r = await requestApproval(act.bursar!, "DISCOUNT_ASSIGN", { studentId: ids.s2, discountId: ids.sibling, academicYearId: ids.year, termId: term.id }, "", meta);
    await withRls(A, (tx) => assignStudentDiscount(tx, { tenantId: A, actorId: ids.proprietor! }, { studentId: ids.s2!, discountId: ids.sibling!, academicYearId: ids.year!, termId: term.id, note: undefined }));
    expect(await decide(act.proprietor!, r.id, { decision: "APPROVE", comment: "", expectedStep: 1 }, meta)).toEqual({ outcome: "failed", code: "discount.alreadyAssigned" });
    expect(await prisma.studentDiscount.count({ where: { studentId: ids.s2 } })).toBe(1);
  });
});

describe("who sees what", () => {
  it("the inbox shows each approver only what they can decide now; admins see everything; requesters their own", async () => {
    const pending = await requestApproval(act.bursar!, "PAYMENT_REVERSAL", { paymentId: ids.pay1, reason: "Final" }, "", meta);
    expect((await listRequests(act.admin2!, { tab: "waiting" })).rows.map((r) => r.id)).toEqual([pending.id]);
    expect((await listRequests(act.bursar2!, { tab: "waiting" })).rows).toEqual([]);
    expect((await listRequests(act.bursar!, { tab: "mine" })).total).toBeGreaterThanOrEqual(6);
    await expect(listRequests(act.bursar!, { tab: "all" })).rejects.toEqual(new ApprovalError("notAllowed"));
    expect((await listRequests(act.proprietor!, { tab: "all" })).total).toBe((await prisma.approvalRequest.count({ where: { tenantId: A } })));
    expect((await getRequest(act.admin2!, pending.id))?.canDecide).toBe(true);
    expect((await getRequest(act.bursar!, pending.id))?.canWithdraw).toBe(true);
    expect(await getRequest(act.teacher!, pending.id)).toBeNull();
    expect(await getRequest(act.bAdmin!, pending.id)).toBeNull();
    expect((await listRequests(act.support!, { tab: "waiting" })).rows).toEqual([]);
  });

  it("another school can't read the requests or decisions, even through the database role", async () => {
    expect(await withRls(B, (tx) => tx.approvalRequest.count({ where: { tenantId: A } }))).toBe(0);
    expect(await withRls(B, (tx) => tx.approvalDecision.count())).toBe(0);
    expect(await withRls(A, (tx) => tx.approvalRequest.count())).toBeGreaterThan(0);
  });

  it("the app's database role can't delete requests or delete decisions, even in its own school", async () => {
    await expect(withRls(A, (tx) => tx.approvalRequest.deleteMany({ where: { tenantId: A } }))).rejects.toThrow();
    await expect(withRls(A, (tx) => tx.approvalDecision.deleteMany({ where: { tenantId: A } }))).rejects.toThrow();
    expect(await prisma.approvalDecision.count({ where: { tenantId: A } })).toBeGreaterThan(0);
  });
});
