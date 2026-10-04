import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant, prisma, withRls } from "@educore/db";
import { createInvoice, recordPayment } from "../invoice-writer";
import { settleOnlinePayment, startOnlineCheckout } from "./online";
import type { PaymentProvider, Verification } from "./paystack";

/**
 * Online payments end to end against a real Postgres (migrations 0001–0016),
 * with a fake Paystack: checkout → verification → payment + receipt, and
 * the guarantees around it (never recorded twice, mismatches go to a person,
 * an invoice settled meanwhile isn't overpaid, schools stay separate).
 */

const stamp = Date.now();
let A: string;
let B: string;
let invoiceId: string;
let studentId: string;
let parentId: string;
const verifications = new Map<string, Verification>();
let initialized: string[] = [];

const fake: PaymentProvider = {
  name: "paystack",
  configured: () => true,
  async initialize(req) {
    initialized.push(req.reference);
    return { authorizationUrl: `https://checkout.paystack.test/${req.reference}` };
  },
  async verify(reference) {
    // A short pause makes the concurrent test meaningful.
    await new Promise((r) => setTimeout(r, 20));
    return verifications.get(reference) ?? { status: "pending", amountMinor: 0, currency: "NGN", reference, paidAt: null, channel: null, message: null };
  },
  verifySignature: () => true,
};
const ok = (reference: string, amountMinor: number, over: Partial<Verification> = {}): Verification => ({
  status: "success", amountMinor, currency: "NGN", reference, paidAt: new Date("2026-09-15T10:00:00Z"), channel: "card", message: "Approved", ...over,
});

async function start(amountMinor: number) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  return startOnlineCheckout(
    {
      tenantId: A,
      payer: { id: parentId, email: "parent@example.test" },
      invoice: { id: inv.id, studentId: inv.studentId, invoiceNo: inv.invoiceNo, currency: inv.currency },
      amountMinor,
      callbackUrl: (ref) => `https://school.test/api/payments/paystack/callback?reference=${ref}`,
    },
    fake,
  );
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Online A", slug: `on-a-${stamp}`, subdomain: `on-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Online B", slug: `on-b-${stamp}`, subdomain: `on-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  const term = await prisma.term.create({ data: { tenantId: A, academicYearId: year.id, name: "First", order: 1, startDate: new Date("2026-09-07"), endDate: new Date("2026-12-18") } });
  const student = await prisma.student.create({ data: { tenantId: A, admissionNo: `ON-${stamp}`, firstName: "Ada", lastName: "Pay", academicYearId: year.id } });
  studentId = student.id;
  const tuition = await prisma.feeType.create({ data: { tenantId: A, name: "Tuition" } });
  const parent = await prisma.user.create({ data: { tenantId: A, email: `parent-${stamp}@example.test`, name: "Parent", role: "PARENT" } });
  parentId = parent.id;
  const inv = await withRls(A, (tx) =>
    createInvoice(tx, { tenantId: A, actorId: null }, {
      studentId,
      term: { id: term.id, academicYearId: year.id, yearStart: year.startDate },
      bill: { lines: [{ kind: "FEE", feeTypeId: tuition.id, description: "Tuition", amountMinor: 10000000 }], skipped: [], unusedDiscounts: [], subtotalMinor: 10000000, discountMinor: 0, totalMinor: 10000000 },
      dueDate: new Date("2026-09-30"),
      currency: "NGN",
      prefix: "INV",
    }),
  );
  invoiceId = inv.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined); // audit log is append-only
  await prisma.$disconnect();
});

describe("online payments", () => {
  it("records the attempt before sending the parent to the provider", async () => {
    initialized = [];
    const { reference, authorizationUrl } = await start(4000000);
    expect(initialized).toEqual([reference]);
    expect(authorizationUrl).toContain(reference);
    const attempt = await prisma.onlinePayment.findUniqueOrThrow({ where: { reference } });
    expect(attempt).toMatchObject({ status: "PENDING", tenantId: A, invoiceId, payerId: parentId, currency: "NGN" });
    expect(attempt.amount.toString()).toBe("40000");
  });

  it("a confirmed payment becomes a real payment with a receipt — once, however often it's confirmed", async () => {
    const { reference } = await start(4000000);
    verifications.set(reference, ok(reference, 4000000));
    const first = await settleOnlinePayment(reference, fake);
    expect(first).toMatchObject({ result: "paid", invoiceId });
    const again = await settleOnlinePayment(reference, fake); // the webhook after the return page
    expect(again).toEqual(first);
    const payments = await prisma.payment.findMany({ where: { invoiceId, method: "PAYSTACK" } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ reference, recordedById: parentId });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("PARTIALLY_PAID");
  });

  it("the return page and the webhook arriving together still record it once", async () => {
    const { reference } = await start(1000000);
    verifications.set(reference, ok(reference, 1000000));
    const results = await Promise.all([settleOnlinePayment(reference, fake), settleOnlinePayment(reference, fake)]);
    expect(results.every((r) => r.result === "paid")).toBe(true);
    expect(await prisma.payment.count({ where: { reference } })).toBe(1);
  });

  it("an amount that doesn't match goes to a person, not onto the invoice", async () => {
    const { reference } = await start(1000000);
    verifications.set(reference, ok(reference, 999900));
    expect(await settleOnlinePayment(reference, fake)).toMatchObject({ result: "review" });
    expect(await prisma.payment.count({ where: { reference } })).toBe(0);
    expect((await prisma.onlinePayment.findUniqueOrThrow({ where: { reference } })).message).toBe("amountMismatch");
  });

  it("failed and abandoned checkouts are marked, and an abandoned one can still succeed later", async () => {
    const { reference } = await start(1000000);
    verifications.set(reference, ok(reference, 1000000, { status: "abandoned" }));
    expect(await settleOnlinePayment(reference, fake)).toMatchObject({ result: "abandoned" });
    verifications.set(reference, ok(reference, 1000000));
    expect(await settleOnlinePayment(reference, fake)).toMatchObject({ result: "paid" });
    const failed = await start(1000000);
    verifications.set(failed.reference, ok(failed.reference, 1000000, { status: "failed" }));
    expect(await settleOnlinePayment(failed.reference, fake)).toMatchObject({ result: "failed" });
  });

  it("money for an invoice settled at the bursary meanwhile is flagged for review, never overpaid", async () => {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const balance = 10000000 - Number(inv.amountPaid) * 100;
    const { reference } = await start(balance);
    await withRls(A, (tx) =>
      recordPayment(tx, { tenantId: A, actorId: null }, { invoiceId, amountMinor: balance, method: "CASH", reference: null, note: null, paidAt: new Date("2026-09-20"), today: new Date("2026-10-04"), receiptPrefix: "RCT" }),
    );
    verifications.set(reference, ok(reference, balance));
    expect(await settleOnlinePayment(reference, fake)).toMatchObject({ result: "review" });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(after.status).toBe("PAID");
    expect(after.amountPaid.toString()).toBe("100000");
    expect((await prisma.onlinePayment.findUniqueOrThrow({ where: { reference } })).status).toBe("NEEDS_REVIEW");
  });

  it("ignores references it didn't issue", async () => {
    expect(await settleOnlinePayment("EDU-0000000000aaaaaaaaaa", fake)).toEqual({ result: "unknown" });
    expect(await settleOnlinePayment("'; DROP TABLE payments; --", fake)).toEqual({ result: "unknown" });
  });

  it("another school can't see or write these attempts", async () => {
    expect(await forTenant(B).onlinePayment.count()).toBe(0);
    await expect(
      withRls(B, (tx) =>
        tx.$executeRaw`INSERT INTO online_payments (id, "tenantId", "invoiceId", "studentId", reference, amount, currency) VALUES (${`op-x-${stamp}`}, ${A}, ${invoiceId}, ${studentId}, ${`EDU-x-${stamp}`}, 10, 'NGN')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(withRls(A, (tx) => tx.$executeRaw`DELETE FROM online_payments`)).rejects.toThrow(/permission denied/);
  });
});
