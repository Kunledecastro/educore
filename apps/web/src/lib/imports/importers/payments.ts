import type { PaymentMethod, PrismaClient } from "@educore/db";
import { toMinor } from "@/lib/fees";
import { todayInTimeZone } from "@/lib/format";
import { FeeRuleError, recordPayment } from "@/lib/invoice-writer";
import { parseTenantSettings } from "@/lib/tenant-settings";
import { parseDayFirstDate, type ColumnDef } from "../csv";
import { ImportRowError } from "../errors";
import type { FieldIssue, ImportContext, Importer } from "../types";
import { norm, pickEnum } from "./shared";

/**
 * Payments from a bank statement (milestone 3.2). Each row is matched to an
 * invoice by invoice number, or else by admission number (the student's
 * oldest invoice that still has a balance). The reference is required: it's
 * how a re-imported statement is recognised — a row whose reference is
 * already recorded is reported, never paid twice. Rows can't pay more than
 * an invoice's balance, counting earlier rows of the same file.
 */

const COLUMNS: ColumnDef[] = [
  { key: "invoiceNo", header: "invoice_no", aliases: ["invoice number", "invoice", "inv no"], required: false, example: "INV-2026-00001" },
  { key: "admissionNo", header: "admission_no", aliases: ["admission number", "admission no", "adm no", "reg no"], required: false, example: "GA-2026-0001" },
  { key: "amount", header: "amount", aliases: ["amount paid", "credit", "value"], required: true, example: "150000" },
  { key: "date", header: "date", aliases: ["payment date", "value date", "transaction date"], required: true, example: "15/09/2026" },
  { key: "reference", header: "reference", aliases: ["ref", "transaction reference", "narration ref", "teller no"], required: true, example: "FT2609150001" },
  { key: "method", header: "method", aliases: ["payment method", "channel"], required: false, example: "Bank transfer" },
  { key: "note", header: "note", aliases: ["narration", "remarks", "description"], required: false, example: "Paid by father" },
];

const METHODS: Record<string, PaymentMethod> = {
  transfer: "BANK_TRANSFER", "bank transfer": "BANK_TRANSFER", bank: "BANK_TRANSFER", "bank_transfer": "BANK_TRANSFER",
  cash: "CASH", pos: "POS", card: "POS", cheque: "CHEQUE", check: "CHEQUE",
};

export interface PaymentRow {
  invoiceId: string;
  amountMinor: number;
  paidAt: Date;
  reference: string;
  method: PaymentMethod;
  note: string | null;
}

interface OpenInvoice {
  id: string;
  invoiceNo: string;
  balance: number;
  dueDate: number;
}

export interface PaymentLookup {
  today: Date;
  byInvoiceNo: Map<string, OpenInvoice & { cancelled: boolean }>;
  /** admission no → that student's invoices with a balance, oldest due first */
  byAdmissionNo: Map<string, OpenInvoice[]>;
  /** "method|reference" of payments already recorded (not reversed) */
  recorded: Set<string>;
}

const refKey = (method: string, reference: string) => `${method}|${reference.trim().toLowerCase()}`;

async function loadLookup(tx: PrismaClient, ctx: ImportContext): Promise<PaymentLookup> {
  const [tenant, invoices, payments] = await Promise.all([
    tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } }),
    tx.invoice.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, invoiceNo: true, status: true, totalDue: true, amountPaid: true, dueDate: true, student: { select: { admissionNo: true } } },
    }),
    tx.payment.findMany({ where: { tenantId: ctx.tenantId, kind: "PAYMENT", reference: { not: null }, reversedBy: null }, select: { method: true, reference: true } }),
  ]);
  const settings = parseTenantSettings(tenant?.settings);
  const byInvoiceNo = new Map<string, OpenInvoice & { cancelled: boolean }>();
  const byAdmissionNo = new Map<string, OpenInvoice[]>();
  for (const inv of invoices) {
    const open: OpenInvoice = { id: inv.id, invoiceNo: inv.invoiceNo, balance: (toMinor(inv.totalDue) ?? 0) - (toMinor(inv.amountPaid) ?? 0), dueDate: inv.dueDate.getTime() };
    byInvoiceNo.set(norm(inv.invoiceNo), { ...open, cancelled: inv.status === "CANCELLED" });
    if (inv.status !== "CANCELLED" && open.balance > 0) {
      const key = norm(inv.student.admissionNo);
      byAdmissionNo.set(key, [...(byAdmissionNo.get(key) ?? []), open].sort((a, b) => a.dueDate - b.dueDate));
    }
  }
  return {
    today: todayInTimeZone(settings.timezone),
    byInvoiceNo,
    byAdmissionNo,
    recorded: new Set(payments.map((p) => refKey(p.method, p.reference!))),
  };
}

function validate(r: Record<string, string>, lookup: PaymentLookup) {
  const issues: FieldIssue[] = [];

  const amountMinor = toMinor(r.amount ?? "");
  if (amountMinor === null || amountMinor === 0) issues.push({ column: "amount", message: "imports.issues.badAmount", params: { value: r.amount ?? "" } });

  const iso = parseDayFirstDate(r.date ?? "");
  const paidAt = iso ? new Date(`${iso}T00:00:00.000Z`) : null;
  if (!paidAt) issues.push({ column: "date", message: "imports.issues.badDate", params: { value: r.date ?? "" } });
  else if (paidAt.getTime() > lookup.today.getTime()) issues.push({ column: "date", message: "imports.issues.futureDate" });

  const method = pickEnum(r.method ?? "", METHODS) ?? (r.method?.trim() ? null : "BANK_TRANSFER");
  if (method === null) issues.push({ column: "method", message: "imports.issues.badMethod", params: { value: r.method ?? "" } });

  const reference = (r.reference ?? "").trim();
  if (!reference) issues.push({ column: "reference", message: "validation.required" });
  else if (reference.length > 80) issues.push({ column: "reference", message: "validation.tooLong" });
  else if (method && lookup.recorded.has(refKey(method, reference))) issues.push({ column: "reference", message: "imports.issues.alreadyRecorded", params: { value: reference } });

  const note = (r.note ?? "").trim();
  if (note.length > 300) issues.push({ column: "note", message: "validation.tooLong" });

  // Which invoice?
  let target: OpenInvoice | undefined;
  if (r.invoiceNo?.trim()) {
    const inv = lookup.byInvoiceNo.get(norm(r.invoiceNo));
    if (!inv) issues.push({ column: "invoice_no", message: "imports.issues.unknownInvoice", params: { value: r.invoiceNo } });
    else if (inv.cancelled) issues.push({ column: "invoice_no", message: "imports.issues.invoiceCancelled", params: { value: r.invoiceNo } });
    else if (inv.balance <= 0) issues.push({ column: "invoice_no", message: "imports.issues.invoicePaid", params: { value: r.invoiceNo } });
    else target = inv;
  } else if (r.admissionNo?.trim()) {
    const open = lookup.byAdmissionNo.get(norm(r.admissionNo))?.find((i) => i.balance > 0);
    if (!open) issues.push({ column: "admission_no", message: "imports.issues.noOpenInvoice", params: { value: r.admissionNo } });
    else target = open;
  } else {
    issues.push({ column: "invoice_no", message: "imports.issues.invoiceOrAdmissionRequired" });
  }

  if (target && amountMinor && amountMinor > target.balance) {
    issues.push({ column: "amount", message: "imports.issues.moreThanBalance", params: { invoice: target.invoiceNo, balance: (target.balance / 100).toFixed(2) } });
  }

  if (issues.length || !target || !amountMinor || !paidAt || !method || !reference) return { issues };
  // Later rows of the same file see what this row has paid.
  target.balance -= amountMinor;
  lookup.recorded.add(refKey(method, reference));
  return { row: { invoiceId: target.id, amountMinor, paidAt, reference, method, note: note || null }, issues };
}

export const paymentsImporter: Importer<PaymentRow, PaymentLookup> = {
  kind: "PAYMENTS",
  permission: ["payment", "import"],
  columns: COLUMNS,
  needsYear: false,
  loadLookup,
  validate,
  uniqueKeys: (row) => [{ key: refKey(row.method, row.reference), column: "reference" }],
  async apply(tx, ctx, row) {
    const tenant = await tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
    const settings = parseTenantSettings(tenant?.settings);
    try {
      await recordPayment(
        tx,
        { tenantId: ctx.tenantId, actorId: ctx.actorId, ipAddress: null, userAgent: "EduCore import" },
        {
          invoiceId: row.invoiceId,
          amountMinor: row.amountMinor,
          method: row.method,
          reference: row.reference,
          note: row.note,
          paidAt: row.paidAt,
          today: todayInTimeZone(settings.timezone),
          receiptPrefix: settings.receiptPrefix,
        },
      );
    } catch (err) {
      if (err instanceof FeeRuleError) throw new ImportRowError(`imports.issues.fee.${err.code}`);
      throw err;
    }
    // recordPayment writes its own audit entry in this transaction.
    return { outcome: "created", audits: [] };
  },
};
