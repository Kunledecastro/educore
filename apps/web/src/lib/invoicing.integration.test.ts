import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant, Prisma, prisma, withRls } from "@educore/db";
import { billBatch, finishRun, startRun } from "./billing-run";
import { billsFor } from "./fees-data";
import { applyRows, validateCsv } from "./imports/engine";
import { paymentsImporter } from "./imports/importers/payments";
import { addAdjustment, cancelInvoice, createInvoice, FeeRuleError, recordPayment, reversePayment, settleInvoice } from "./invoice-writer";

/**
 * Invoicing and payments end to end against a real Postgres (migrations
 * 0001–0015 applied): billing maths → invoices → numbering → payments →
 * reversals → cancellation, plus the database guarantees behind them
 * (one live invoice per student per term, append-only payments, row
 * locking, tenant isolation).
 *
 * Run: DATABASE_URL=… pnpm --filter web test:integration
 */

const stamp = Date.now();
let A: string;
let B: string;
let term1: { id: string; academicYearId: string; yearStart: Date };
let term2: { id: string; academicYearId: string; yearStart: Date };
let students: string[] = [];
let classId: string;
let tuition: string;
let bus: string;
let admission: string;
let staffDiscount: string;
const audit = () => ({ tenantId: A, actorId: null, ipAddress: null, userAgent: "integration test" });
const today = new Date("2026-10-10T00:00:00.000Z");

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Billing A", slug: `bill-a-${stamp}`, subdomain: `bill-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Billing B", slug: `bill-b-${stamp}`, subdomain: `bill-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const year = await prisma.academicYear.create({
    data: { tenantId: A, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true },
  });
  const [t1, t2] = await Promise.all([
    prisma.term.create({ data: { tenantId: A, academicYearId: year.id, name: "First", order: 1, startDate: new Date("2026-09-07"), endDate: new Date("2026-12-18"), isCurrent: true } }),
    prisma.term.create({ data: { tenantId: A, academicYearId: year.id, name: "Second", order: 2, startDate: new Date("2027-01-05"), endDate: new Date("2027-04-09") } }),
  ]);
  term1 = { id: t1.id, academicYearId: year.id, yearStart: year.startDate };
  term2 = { id: t2.id, academicYearId: year.id, yearStart: year.startDate };
  const cls = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name: "Grade 5", order: 1 } });
  const section = await prisma.section.create({ data: { tenantId: A, classId: cls.id, name: "A" } });
  classId = cls.id;
  for (let i = 0; i < 3; i++) {
    const s = await prisma.student.create({
      data: { tenantId: A, admissionNo: `B-${stamp}-${i}`, firstName: `S${i}`, lastName: "Test", classId: cls.id, sectionId: section.id, academicYearId: year.id },
    });
    students.push(s.id);
  }
  const [ft1, ft2, ft3] = await Promise.all([
    prisma.feeType.create({ data: { tenantId: A, name: "Tuition", order: 1 } }),
    prisma.feeType.create({ data: { tenantId: A, name: "Bus", order: 2, isOptional: true } }),
    prisma.feeType.create({ data: { tenantId: A, name: "Admission", order: 3, isOneOff: true } }),
  ]);
  tuition = ft1.id;
  bus = ft2.id;
  admission = ft3.id;
  for (const t of [term1, term2]) {
    await prisma.feeStructure.createMany({
      data: [
        { tenantId: A, academicYearId: year.id, termId: t.id, classId: cls.id, feeTypeId: tuition, amount: "150000.00" },
        { tenantId: A, academicYearId: year.id, termId: t.id, classId: cls.id, feeTypeId: bus, amount: "30000.00" },
        { tenantId: A, academicYearId: year.id, termId: t.id, classId: cls.id, feeTypeId: admission, amount: "50000.00" },
      ],
    });
  }
  const d = await prisma.discount.create({ data: { tenantId: A, name: "Staff child", kind: "PERCENT", value: "50.00", feeTypeId: tuition } });
  staffDiscount = d.id;
  await prisma.studentDiscount.create({ data: { tenantId: A, studentId: students[1]!, discountId: d.id, academicYearId: year.id } });
  await prisma.feeSignup.create({ data: { tenantId: A, studentId: students[2]!, feeTypeId: bus, termId: term1.id } });
});

afterAll(async () => {
  // The audit log is append-only for everyone (trigger), so schools that wrote
  // audit entries can't be deleted: the test schools (unique per run) stay.
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

async function bill(studentId: string, term = term1) {
  const bills = await billsFor(forTenant(A), term, [studentId]);
  return withRls(A, (tx) => createInvoice(tx, audit(), { studentId, term, bill: bills.get(studentId)!, dueDate: new Date("2026-09-30"), currency: "NGN", prefix: "INV" }));
}

describe("billing", () => {
  it("works out every student's bill in one go: compulsory items, sign-ups, one-off items and discounts", async () => {
    const bills = await billsFor(forTenant(A), term1, students);
    expect(bills.get(students[0]!)!.totalMinor).toBe(20000000); // tuition + admission
    expect(bills.get(students[1]!)!.totalMinor).toBe(12500000); // tuition − 50% + admission
    expect(bills.get(students[2]!)!.totalMinor).toBe(23000000); // + bus
  });

  it("issues invoices with gap-free numbers and the bill's lines", async () => {
    const inv0 = await bill(students[0]!);
    const inv1 = await bill(students[1]!);
    expect(inv0.invoiceNo).toBe("INV-2026-00001");
    expect(inv1.invoiceNo).toBe("INV-2026-00002");
    expect(inv1.lines.map((l) => [l.kind, l.description, l.amount.toString()])).toEqual([
      ["FEE", "Tuition", "150000"],
      ["FEE", "Admission", "50000"],
      ["DISCOUNT", "Staff child", "-75000"],
    ]);
    expect(inv1.totalDue.toString()).toBe("125000");
    expect(inv1.status).toBe("ISSUED");
  });

  it("never issues two live invoices to one student for one term", async () => {
    await expect(bill(students[0]!)).rejects.toMatchObject({ code: "P2002" });
    // …and the failed attempt didn't burn a number.
    const inv2 = await bill(students[2]!);
    expect(inv2.invoiceNo).toBe("INV-2026-00003");
  });

  it("bills a one-off item only once", async () => {
    const second = await billsFor(forTenant(A), term2, [students[0]!]);
    expect(second.get(students[0]!)!.lines.map((l) => l.description)).toEqual(["Tuition"]);
    expect(second.get(students[0]!)!.skipped).toContainEqual({ feeTypeId: admission, name: "Admission", reason: "alreadyBilled" });
  });

  it("keeps a discount line's link to its discount", async () => {
    const lines = await prisma.invoiceLine.findMany({ where: { tenantId: A, kind: "DISCOUNT" } });
    expect(lines.every((l) => l.discountId === staffDiscount)).toBe(true);
  });
});

describe("payments and receipts", () => {
  let invoiceId: string;

  beforeAll(async () => {
    invoiceId = (await prisma.invoice.findFirstOrThrow({ where: { tenantId: A, studentId: students[0]!, termId: term1.id } })).id;
  });

  const pay = (amountMinor: number, paidAt = today) =>
    withRls(A, (tx) =>
      recordPayment(tx, audit(), { invoiceId, amountMinor, method: "BANK_TRANSFER", reference: `REF-${amountMinor}-${Math.random()}`, note: null, paidAt, today, receiptPrefix: "RCT" }),
    );

  it("records a part payment with a receipt number and updates the invoice", async () => {
    const { payment, invoice } = await pay(5000000);
    expect(payment.receiptNo).toBe("RCT-2026-00001");
    expect(invoice.status).toBe("PARTIALLY_PAID");
    expect(invoice.amountPaid.toString()).toBe("50000");
  });

  it("refuses to take more than the balance, or a future date", async () => {
    await expect(pay(15000001)).rejects.toThrow(FeeRuleError);
    await expect(pay(100, new Date("2026-10-11T00:00:00.000Z"))).rejects.toMatchObject({ code: "futureDate" });
  });

  it("two simultaneous payments for the whole balance: exactly one succeeds", async () => {
    const results = await Promise.allSettled([pay(15000000), pay(15000000)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "invoicePaid" }); // the loser waited for the lock, then saw a settled invoice
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.status).toBe("PAID");
    expect(inv.amountPaid.toString()).toBe("200000");
  });

  it("a reversal undoes a payment once, without changing or deleting it", async () => {
    const original = await prisma.payment.findFirstOrThrow({ where: { invoiceId, receiptNo: "RCT-2026-00001" } });
    const { reversal, invoice } = await withRls(A, (tx) => reversePayment(tx, audit(), { paymentId: original.id, reason: "Bounced transfer" }));
    expect(reversal.amount.toString()).toBe("-50000");
    expect(reversal.reference).toBe("RCT-2026-00001");
    expect(invoice.status).toBe("PARTIALLY_PAID");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: original.id } })).amount.toString()).toBe("50000");
    await expect(withRls(A, (tx) => reversePayment(tx, audit(), { paymentId: original.id, reason: "again" }))).rejects.toMatchObject({ code: "alreadyReversed" });
    await expect(withRls(A, (tx) => reversePayment(tx, audit(), { paymentId: reversal.id, reason: "x" }))).rejects.toMatchObject({ code: "notAPayment" });
  });

  it("payments are append-only for the application: no UPDATE, no DELETE", async () => {
    await expect(withRls(A, (tx) => tx.$executeRaw`UPDATE payments SET amount = 1 WHERE "invoiceId" = ${invoiceId}`)).rejects.toThrow(/permission denied/);
    await expect(withRls(A, (tx) => tx.$executeRaw`DELETE FROM payments WHERE "invoiceId" = ${invoiceId}`)).rejects.toThrow(/permission denied/);
  });

  it("every payment and reversal is in the audit log", async () => {
    const entries = await prisma.auditLog.count({ where: { tenantId: A, entityType: "Payment" } });
    expect(entries).toBe(3); // part payment, the winning full payment, the reversal
  });

  it("settling again from the payments gives the same answer (amountPaid is derived)", async () => {
    const inv = await withRls(A, (tx) => settleInvoice(tx, A, invoiceId));
    expect(inv.amountPaid.toString()).toBe("150000");
  });
});

describe("adjustments and cancellation", () => {
  it("an adjustment can't take the total below what's been paid", async () => {
    const inv = await prisma.invoice.findFirstOrThrow({ where: { tenantId: A, studentId: students[0]!, termId: term1.id } });
    await expect(withRls(A, (tx) => addAdjustment(tx, audit(), { invoiceId: inv.id, description: "Credit", amountMinor: -6000000 }))).rejects.toMatchObject({ code: "belowPaid" });
    const after = await withRls(A, (tx) => addAdjustment(tx, audit(), { invoiceId: inv.id, description: "Credit", amountMinor: -5000000 }));
    expect(after.status).toBe("PAID");
    expect(after.totalDue.toString()).toBe("150000");
  });

  it("an invoice with money on it can't be cancelled; an unpaid one can, and the student can then be billed again", async () => {
    const paid = await prisma.invoice.findFirstOrThrow({ where: { tenantId: A, studentId: students[0]!, termId: term1.id } });
    await expect(withRls(A, (tx) => cancelInvoice(tx, audit(), { invoiceId: paid.id, reason: "x" }))).rejects.toMatchObject({ code: "hasPayments" });
    const unpaid = await prisma.invoice.findFirstOrThrow({ where: { tenantId: A, studentId: students[2]!, termId: term1.id } });
    const cancelled = await withRls(A, (tx) => cancelInvoice(tx, audit(), { invoiceId: unpaid.id, reason: "Wrong class" }));
    expect(cancelled.status).toBe("CANCELLED");
    const again = await bill(students[2]!);
    expect(again.invoiceNo).toBe("INV-2026-00004");
  });
});

describe("tenant isolation for invoicing tables", () => {
  it("another school sees none of these invoices, payments, counters or billing runs", async () => {
    const db = forTenant(B);
    expect(await db.invoice.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
    const raw = await withRls(B, (tx) =>
      tx.$queryRaw<{ n: bigint }[]>`SELECT (SELECT count(*) FROM invoices) + (SELECT count(*) FROM payments) + (SELECT count(*) FROM number_sequences) + (SELECT count(*) FROM billing_runs) AS n`,
    );
    expect(Number(raw[0]!.n)).toBe(0);
  });

  it("another school can't record a payment against these invoices or take their numbers", async () => {
    const inv = await prisma.invoice.findFirstOrThrow({ where: { tenantId: A } });
    await expect(
      withRls(B, (tx) => tx.$executeRaw`INSERT INTO payments (id, "tenantId", "invoiceId", "studentId", amount, method) VALUES (${`p-x-${stamp}`}, ${A}, ${inv.id}, ${inv.studentId}, 10, 'CASH')`),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withRls(B, (tx) => tx.$executeRaw`INSERT INTO number_sequences ("tenantId", "key", "value") VALUES (${A}, 'invoice:2026', 999)`),
    ).rejects.toThrow(/row-level security/);
    // B's own counter starts from 1, unaffected by A's.
    const n = await withRls(B, (tx) =>
      tx.$queryRaw<{ value: number }[]>`INSERT INTO number_sequences ("tenantId", "key", "value") VALUES (${B}, 'invoice:2026', 1) RETURNING "value"`,
    );
    expect(Number(n[0]!.value)).toBe(1);
  });

  it("FK checks bypass RLS, so the writer re-checks: B can't settle A's invoice through its own transaction", async () => {
    const inv = await prisma.invoice.findFirstOrThrow({ where: { tenantId: A } });
    await expect(withRls(B, (tx) => settleInvoice(tx, B, inv.id))).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

describe("the bill-the-term run", () => {
  async function runOnce() {
    const run = await prisma.billingRun.create({ data: { tenantId: A, termId: term2.id, classIds: [classId], dueDate: new Date("2027-01-20") } });
    const plan = await startRun(A, run.id);
    expect(plan).not.toBeNull();
    // Two batches of 2 + 1, as Inngest would step through them.
    await billBatch(A, run.id, plan!, 0, plan!.studentIds.slice(0, 2));
    await billBatch(A, run.id, plan!, 2, plan!.studentIds.slice(2));
    await finishRun(A, run.id, plan!);
    return prisma.billingRun.findUniqueOrThrow({ where: { id: run.id } });
  }

  it("bills every active student of the class once, with progress and totals", async () => {
    const run = await runOnce();
    expect(run).toMatchObject({ status: "COMPLETED", total: 3, done: 3, created: 3, skipped: 0 });
    // Term 2: tuition for all; S1 gets 50% off tuition; nobody signed up for the bus; admission already billed in term 1.
    expect(run.amount.toString()).toBe(String(150000 + 75000 + 150000));
    const invoices = await prisma.invoice.findMany({ where: { tenantId: A, termId: term2.id }, orderBy: { invoiceNo: "asc" } });
    expect(invoices.map((i) => i.billingRunId)).toEqual([run.id, run.id, run.id]);
  });

  it("running it again bills nobody twice", async () => {
    const run = await runOnce();
    expect(run).toMatchObject({ status: "COMPLETED", created: 0, skipped: 3 });
    expect(await prisma.invoice.count({ where: { tenantId: A, termId: term2.id, status: { not: "CANCELLED" } } })).toBe(3);
  });

  it("a run that isn't waiting is never started twice", async () => {
    const run = await prisma.billingRun.findFirstOrThrow({ where: { tenantId: A, status: "COMPLETED" } });
    expect(await startRun(A, run.id)).toBeNull();
  });
});

describe("bank-statement import", () => {
  const ctx = () => ({ tenantId: A, actorId: null, options: {} });

  async function importCsv(csv: string) {
    return withRls(A, async (tx) => {
      const report = validateCsv(paymentsImporter, csv, await paymentsImporter.loadLookup(tx, ctx()));
      const rows = [...report.valid.entries()].map(([line, row]) => ({ line, row }));
      const result = await applyRows(tx, paymentsImporter, ctx(), rows, (e) => String(e));
      return { report, result };
    });
  }

  it("pays invoices by invoice number or admission number, counting earlier rows against the balance", async () => {
    const inv = await prisma.invoice.findFirstOrThrow({ where: { tenantId: A, studentId: students[1]!, termId: term2.id } }); // 75,000
    const s2 = await prisma.student.findUniqueOrThrow({ where: { id: students[2]! } });
    // Dates are in the past whenever this runs (real "today" decides what's in the future).
    const csv = [
      "invoice_no,admission_no,amount,date,reference,method",
      `${inv.invoiceNo},,50000,01/09/2026,STMT-1,transfer`,
      `${inv.invoiceNo},,30000,01/09/2026,STMT-2,transfer`, // only 25,000 left after row 2
      `,${s2.admissionNo},10000,01/09/2026,STMT-3,POS`,
      `,${s2.admissionNo},10000,01/09/2026,STMT-3,POS`, // same reference twice in the file
      `,NOPE,10000,01/09/2026,STMT-4,`,
    ].join("\n");
    const { report, result } = await importCsv(csv);
    expect(report.valid.size).toBe(2);
    expect(report.issues.map((i) => [i.row, i.message])).toEqual([
      [3, "imports.issues.moreThanBalance"],
      [5, "imports.issues.alreadyRecorded"], // the earlier row of this file already claims the reference
      [6, "imports.issues.noOpenInvoice"],
    ]);
    expect(result).toMatchObject({ created: 2, failed: 0 });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("PARTIALLY_PAID");
    expect(after.amountPaid.toString()).toBe("50000");
  });

  it("re-importing the same statement pays nothing twice", async () => {
    const inv = await prisma.invoice.findFirstOrThrow({ where: { tenantId: A, studentId: students[1]!, termId: term2.id } });
    const { report } = await importCsv(["invoice_no,amount,date,reference", `${inv.invoiceNo},50000,01/09/2026,STMT-1`].join("\n"));
    expect(report.valid.size).toBe(0);
    expect(report.issues[0]).toMatchObject({ message: "imports.issues.alreadyRecorded" });
  });
});

