import "server-only";
import type { TenantScopedClient, Prisma } from "@educore/db";
import { createTranslator } from "next-intl";
import { toMinor } from "./fees";
import type { InvoiceDoc, ReceiptDoc, SchoolInfo } from "./fee-pdf";
import { displayStatus, type StoredInvoiceStatus } from "./invoicing";
import { todayInTimeZone } from "./format";
import { parseTenantSettings } from "./tenant-settings";
import { loadDocBranding } from "./branding-data";

/**
 * Loads what an invoice or receipt PDF shows, through the tenant-scoped
 * client AND the caller's student row scope — a parent can only ever load
 * their own children's documents. Null = not found or not allowed.
 */

const m = (v: { toString(): string }) => toMinor(v) ?? 0;

async function school(db: TenantScopedClient, tenantId: string) {
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { name: true, settings: true } });
  const settings = parseTenantSettings(tenant?.settings);
  const info: SchoolInfo = { name: tenant?.name ?? "", locale: settings.locale, currency: settings.currency, dateStyle: settings.dateStyle, branding: await loadDocBranding(tenantId) };
  const lang = settings.locale.toLowerCase().startsWith("fr") ? "fr" : "en";
  const messages = (await import(`../../messages/${lang}.json`)).default;
  const tMethod = createTranslator({ locale: lang, messages, namespace: "fees.invoice.methods" }) as unknown as (k: string) => string;
  return { info, settings, tMethod };
}

const studentSelect = { firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } }, section: { select: { name: true } } } as const;
type StudentBits = { firstName: string; lastName: string; admissionNo: string; class: { name: string } | null; section: { name: string } | null };
const studentInfo = (s: StudentBits) => ({
  name: `${s.firstName} ${s.lastName}`,
  admissionNo: s.admissionNo,
  className: s.class ? `${s.class.name}${s.section ? ` ${s.section.name}` : ""}` : null,
});

export async function loadInvoiceDoc(db: TenantScopedClient, tenantId: string, invoiceId: string, scope: Prisma.StudentWhereInput): Promise<InvoiceDoc | null> {
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId, student: scope },
    include: {
      student: { select: studentSelect },
      term: { select: { name: true } },
      academicYear: { select: { name: true } },
      lines: { orderBy: { position: "asc" } },
      payments: { orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!inv) return null;
  const { info, settings, tMethod } = await school(db, tenantId);
  return {
    school: info,
    invoiceNo: inv.invoiceNo,
    status: displayStatus({ status: inv.status as StoredInvoiceStatus, dueDate: inv.dueDate }, todayInTimeZone(settings.timezone)),
    student: studentInfo(inv.student),
    period: inv.term ? `${inv.term.name} · ${inv.academicYear.name}` : inv.academicYear.name,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    lines: inv.lines.map((l) => ({ kind: l.kind, description: l.description, amountMinor: m(l.amount) })),
    totalMinor: m(inv.totalDue),
    paidMinor: m(inv.amountPaid),
    payments: inv.payments.map((p) => ({ receiptNo: p.receiptNo, date: p.paidAt, method: tMethod(p.method), amountMinor: m(p.amount), reversal: p.kind === "REVERSAL" })),
    cancelReason: inv.cancelReason,
  };
}

export async function loadReceiptDoc(db: TenantScopedClient, tenantId: string, paymentId: string, scope: Prisma.StudentWhereInput): Promise<ReceiptDoc | null> {
  const p = await db.payment.findFirst({
    where: { id: paymentId, kind: "PAYMENT", student: scope },
    include: {
      student: { select: studentSelect },
      invoice: { select: { invoiceNo: true, totalDue: true, term: { select: { name: true } }, academicYear: { select: { name: true } } } },
      recordedBy: { select: { name: true } },
      reversedBy: { select: { id: true } },
    },
  });
  if (!p) return null;
  // Balance right after this payment: everything recorded up to it, reversals included.
  const upTo = await db.payment.aggregate({ where: { invoiceId: p.invoiceId, createdAt: { lte: p.createdAt } }, _sum: { amount: true } });
  const { info, tMethod } = await school(db, tenantId);
  return {
    school: info,
    receiptNo: p.receiptNo ?? "",
    date: p.paidAt,
    student: studentInfo(p.student),
    invoiceNo: p.invoice.invoiceNo,
    period: p.invoice.term ? `${p.invoice.term.name} · ${p.invoice.academicYear.name}` : p.invoice.academicYear.name,
    method: tMethod(p.method),
    reference: p.reference,
    amountMinor: m(p.amount),
    balanceAfterMinor: m(p.invoice.totalDue) - m(upTo._sum.amount ?? 0),
    recordedBy: p.recordedBy?.name ?? null,
    reversed: p.reversedBy !== null,
  };
}
