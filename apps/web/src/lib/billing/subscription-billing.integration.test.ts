import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import { loadEntitlements } from "../entitlements-data";
import type { ChargeRequest, PaymentProvider, Verification } from "../payments/paystack";
import { BillingError, changePlan, chargeRenewal, closeCancelled, dueRenewals, loadBilling, setAutoRenew, settleSubscriptionPayment, startSubscriptionCheckout } from "./subscription-billing";

/**
 * EduCore subscription billing end to end against a real Postgres
 * (migrations through 0019), with a fake Paystack: checkout → card saved →
 * monthly renewals → failures, retries and grace → downgrades → cancelling,
 * plus the guarantees (never charged twice, schools see only their own
 * invoices, the card token never leaves the server, schools can't touch the
 * billing tables).
 */

const stamp = Date.now();
let A: string;
let B: string;
let adminA: string;
const d = (s: string) => new Date(s.length === 10 ? `${s}T08:00:00.000Z` : s);
const actor = () => ({ id: adminA, email: "bursar@a.test", ipAddress: "127.0.0.1", userAgent: "test" });

const verifications = new Map<string, Verification>();
const charges: ChargeRequest[] = [];
let chargeResult: "success" | "failed" | "throw" = "success";
const card = { code: "AUTH_test123", brand: "visa", last4: "4081", expiry: "12/2030" };
const ok = (reference: string, amountMinor: number, over: Partial<Verification> = {}): Verification => ({
  status: "success", amountMinor, currency: "NGN", reference, paidAt: new Date(), channel: "card", message: "Approved",
  authorization: card, customerCode: "CUS_x", customerEmail: "bursar@a.test", ...over,
});
const fake: PaymentProvider = {
  name: "paystack",
  configured: () => true,
  initialize: async (req) => ({ authorizationUrl: `https://checkout.paystack.test/${req.reference}` }),
  verify: async (reference) => verifications.get(reference) ?? { status: "pending", amountMinor: 0, currency: "NGN", reference, paidAt: null, channel: null, message: null },
  verifySignature: () => true,
  async chargeAuthorization(req) {
    charges.push(req);
    if (chargeResult === "throw") throw new Error("socket hang up");
    const v = chargeResult === "success" ? ok(req.reference, req.amountMinor) : ok(req.reference, req.amountMinor, { status: "failed", message: "Insufficient Funds" });
    verifications.set(req.reference, v);
    return v;
  },
};

async function addStudents(tenantId: string, n: number) {
  const year = await prisma.academicYear.create({ data: { tenantId, name: `Y${stamp}${n}`, startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") } });
  await prisma.student.createMany({ data: Array.from({ length: n }, (_, i) => ({ tenantId, admissionNo: `B-${stamp}-${i}`, firstName: "S", lastName: String(i), academicYearId: year.id })) });
}
const sub = (tenantId: string) => prisma.subscription.findUniqueOrThrow({ where: { tenantId } });

beforeAll(async () => {
  // A started its trial on 1 Oct; we "are" on 5 Oct.
  const a = await prisma.tenant.create({ data: { name: "Bill A", slug: `bill-a-${stamp}`, subdomain: `bill-a-${stamp}`, createdAt: d("2026-10-01") } });
  const b = await prisma.tenant.create({ data: { name: "Bill B", slug: `bill-b-${stamp}`, subdomain: `bill-b-${stamp}` } });
  A = a.id;
  B = b.id;
  adminA = (await prisma.user.create({ data: { tenantId: A, email: `admin-${stamp}@a.test`, name: "Admin", role: "SCHOOL_ADMIN" } })).id;
  await addStudents(A, 40);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined); // audit log is append-only
  await prisma.$disconnect();
});

describe("checkout", () => {
  it("won't sell the trial or a hidden plan", async () => {
    await expect(startSubscriptionCheckout({ tenantId: A, actor: actor(), plan: "FREE_TRIAL", callbackUrl: (r) => r }, fake, d("2026-10-05"))).rejects.toEqual(new BillingError("planNotForSale"));
  });

  it("paying during the trial keeps the trial: the first month starts when it ends, and the card is saved", async () => {
    const now = d("2026-10-05");
    const abandoned = await startSubscriptionCheckout({ tenantId: A, actor: actor(), plan: "STARTER", callbackUrl: (r) => r }, fake, now);
    const { reference, amountMinor, invoiceNumber } = await startSubscriptionCheckout({ tenantId: A, actor: actor(), plan: "STANDARD", callbackUrl: (r) => r }, fake, now);
    expect(amountMinor).toBe(40 * 50_000); // ₦20,000
    expect(invoiceNumber).toMatch(/^ECI-\d{6}$/);
    // Starting a second checkout replaced the first unpaid invoice.
    expect((await prisma.platformPayment.findUniqueOrThrow({ where: { reference: abandoned.reference }, include: { invoice: true } })).invoice.status).toBe("VOID");

    verifications.set(reference, ok(reference, amountMinor));
    expect(await settleSubscriptionPayment(reference, fake, undefined, now)).toEqual({ result: "paid", invoiceNumber });
    expect(await settleSubscriptionPayment(reference, fake, undefined, now)).toEqual({ result: "paid", invoiceNumber }); // webhook after the return page

    const inv = await prisma.platformInvoice.findFirstOrThrow({ where: { number: invoiceNumber } });
    expect(inv).toMatchObject({ status: "PAID", plan: "STANDARD", students: 40, periodStart: d("2026-10-31"), periodEnd: d("2026-11-30") });
    expect(await sub(A)).toMatchObject({ plan: "STANDARD", status: "ACTIVE", currentPeriodEnd: d("2026-11-30"), paystackAuthorizationCode: "AUTH_test123", cardLast4: "4081", billingEmail: "bursar@a.test" });
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: A } })).plan).toBe("STANDARD");
    expect(await loadEntitlements(A, now)).toMatchObject({ state: "active", plan: "STANDARD" });
  });

  it("a paid amount that doesn't match goes to review, not onto the subscription", async () => {
    const { reference, amountMinor } = await startSubscriptionCheckout({ tenantId: B, actor: { ...actor(), id: "x" }, plan: "STARTER", callbackUrl: (r) => r }, fake, d("2026-10-05"));
    verifications.set(reference, ok(reference, amountMinor - 100));
    expect(await settleSubscriptionPayment(reference, fake)).toMatchObject({ result: "review" });
    expect(await prisma.subscription.findUnique({ where: { tenantId: B } })).toBeNull();
    expect(await settleSubscriptionPayment("ECB-0000000000aaaaaaaaaa", fake)).toEqual({ result: "unknown" });
    expect(await settleSubscriptionPayment("EDU-0000000000aaaaaaaaaa", fake)).toEqual({ result: "unknown" });
  });
});

describe("changing plan while paying", () => {
  it("upgrades now, downgrades at renewal, and can take the downgrade back", async () => {
    const now = d("2026-11-10");
    expect(await changePlan(A, "PREMIUM", actor(), now)).toBe("switchNow");
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: A } })).plan).toBe("PREMIUM");
    expect(await changePlan(A, "STARTER", actor(), now)).toBe("scheduleDowngrade");
    expect((await sub(A)).pendingPlan).toBe("STARTER");
    expect(await changePlan(A, "PREMIUM", actor(), now)).toBe("cancelScheduled");
    expect((await sub(A)).pendingPlan).toBeNull();
    await expect(changePlan(A, "PREMIUM", actor(), now)).rejects.toEqual(new BillingError("nothingToChange"));
    expect(await changePlan(A, "STANDARD", actor(), now)).toBe("scheduleDowngrade");
    // 4 plan changes + the checkout payment, each in the school's own log.
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "Subscription", actorId: adminA } })).toBe(5);
  });
});

describe("renewals", () => {
  it("charges the saved card when the month ends — once — and applies the scheduled downgrade", async () => {
    const now = d("2026-11-30");
    expect(await dueRenewals(d("2026-11-29"))).not.toContain(A);
    expect(await dueRenewals(now)).toContain(A);
    charges.length = 0;
    chargeResult = "success";
    const [first, second] = await Promise.all([chargeRenewal(A, fake, now), chargeRenewal(A, fake, now)]);
    // The second run either finds nothing due or finds the first's charge and reports it: the card is charged once.
    expect([first.result, second.result]).toContain("paid");
    for (const r of [first.result, second.result]) expect(["paid", "notDue"]).toContain(r);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ authorizationCode: "AUTH_test123", email: "bursar@a.test", amountMinor: 40 * 50_000 });
    expect(await sub(A)).toMatchObject({ plan: "STANDARD", pendingPlan: null, status: "ACTIVE", currentPeriodEnd: d("2026-12-30") });
  });

  it("a declined card: overdue, retried 1, 3 and 6 days later inside the grace week, then left for the school to pay", async () => {
    const due = d("2026-12-30");
    chargeResult = "failed";
    charges.length = 0;
    expect(await chargeRenewal(A, fake, due)).toMatchObject({ result: "failed" });
    expect(await sub(A)).toMatchObject({ status: "PAST_DUE", failedAttempts: 1, nextChargeAt: d("2026-12-31"), lastChargeError: "Insufficient Funds" });
    expect(await loadEntitlements(A, d("2026-12-31"))).toMatchObject({ state: "grace", canWrite: true });

    expect(await chargeRenewal(A, fake, d("2026-12-30T20:00:00.000Z"))).toEqual({ result: "notDue" }); // not before the retry date
    for (const day of ["2026-12-31", "2027-01-02", "2027-01-05"]) await chargeRenewal(A, fake, d(day));
    expect(charges).toHaveLength(4);
    expect(await sub(A)).toMatchObject({ failedAttempts: 4, nextChargeAt: null });
    expect(await dueRenewals(d("2027-01-20"))).not.toContain(A);
    expect(await loadEntitlements(A, d("2027-01-07"))).toMatchObject({ state: "readOnly", canWrite: false });
    // One invoice for the month, however many attempts.
    expect(await prisma.platformInvoice.count({ where: { tenantId: A, periodStart: due, status: { not: "VOID" } } })).toBe(1);
  });

  it("paying from the billing page after read-only starts a fresh month and switches everything back on", async () => {
    const now = d("2027-01-10");
    const { reference, amountMinor } = await startSubscriptionCheckout({ tenantId: A, actor: actor(), plan: "STANDARD", callbackUrl: (r) => r }, fake, now);
    verifications.set(reference, ok(reference, amountMinor));
    await settleSubscriptionPayment(reference, fake, undefined, now);
    expect(await sub(A)).toMatchObject({ status: "ACTIVE", failedAttempts: 0, nextChargeAt: null, currentPeriodEnd: d("2027-02-10") });
    expect(await loadEntitlements(A, now)).toMatchObject({ state: "active", canWrite: true });
  });

  it("if Paystack doesn't answer a charge, the attempt is checked next time — never charged blind twice", async () => {
    const due = d("2027-02-10");
    chargeResult = "throw";
    charges.length = 0;
    expect(await chargeRenewal(A, fake, due)).toMatchObject({ result: "pending" });
    const pending = await prisma.platformPayment.findFirstOrThrow({ where: { tenantId: A, status: "PENDING", kind: "RENEWAL" } });
    verifications.set(pending.reference, ok(pending.reference, pending.amountMinor)); // it did go through
    expect(await chargeRenewal(A, fake, due)).toMatchObject({ result: "paid" });
    expect(charges).toHaveLength(1);
    expect((await sub(A)).currentPeriodEnd).toEqual(d("2027-03-10"));
  });

  it("turning auto-renew off ends the plan with the paid month", async () => {
    await setAutoRenew(A, false, actor());
    expect(await dueRenewals(d("2027-03-11"))).not.toContain(A);
    expect(await closeCancelled(d("2027-03-11"))).toBeGreaterThanOrEqual(1);
    expect(await sub(A)).toMatchObject({ status: "CANCELLED" });
    expect(await loadEntitlements(A, d("2027-03-11"))).toMatchObject({ state: "readOnly" });
    await expect(setAutoRenew(A, true, actor())).rejects.toEqual(new BillingError("notPaying"));
  });
});

describe("isolation", () => {
  it("a school sees only its own EduCore invoices, and never the card token", async () => {
    const a = await loadBilling(A);
    const b = await loadBilling(B);
    expect(a.invoices.length).toBeGreaterThan(0);
    expect(a.invoices.every((i) => i.tenantId === A)).toBe(true);
    expect(b.invoices.every((i) => i.tenantId === B)).toBe(true);
    expect(JSON.stringify(a)).not.toContain("AUTH_");
    expect(a.subscription?.hasCard).toBe(true);
    const audits = await prisma.platformAuditLog.findMany({ where: { tenantId: A } });
    expect(JSON.stringify(audits)).not.toContain("AUTH_test123");
  });

  it("school sessions can't read or write billing tables", async () => {
    for (const table of ["platform_invoices", "platform_payments", "subscriptions"]) {
      await expect(withRls(A, (tx) => tx.$queryRawUnsafe(`SELECT count(*) FROM ${table} WHERE "tenantId" = '${A}'`))).rejects.toThrow(/permission denied|row-level/);
    }
  });

  it("the database refuses a wrong amount, a second live invoice for a month, or a second success for an invoice", async () => {
    const inv = await prisma.platformInvoice.findFirstOrThrow({ where: { tenantId: A, status: "PAID" } });
    await expect(prisma.platformInvoice.create({ data: { tenantId: A, plan: "STARTER", periodStart: new Date("2030-01-01"), periodEnd: new Date("2030-02-01"), students: 2, unitPriceMinor: 100, amountMinor: 999 } })).rejects.toThrow(/platform_invoices_amount/);
    await expect(prisma.platformInvoice.create({ data: { tenantId: A, plan: "STARTER", periodStart: inv.periodStart, periodEnd: inv.periodEnd, students: 1, unitPriceMinor: 100, amountMinor: 100 } })).rejects.toThrow();
    await expect(prisma.platformPayment.create({ data: { tenantId: A, invoiceId: inv.id, reference: "ECB-ffffffffffffffffffff", kind: "RENEWAL", amountMinor: 1, status: "SUCCEEDED" } })).rejects.toThrow();
  });
});
