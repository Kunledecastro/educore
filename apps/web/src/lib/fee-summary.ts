import "server-only";
import type { Prisma, TenantScopedClient } from "@educore/db";
import { toMinor } from "./fees";

/**
 * Money totals for a set of invoices (any Prisma filter), in minor units:
 * billed (live invoices), paid, outstanding, overdue (unpaid part of live
 * invoices past their due date). Cancelled invoices never count.
 */
export async function feeTotals(db: TenantScopedClient, where: Prisma.InvoiceWhereInput, today: Date) {
  const live: Prisma.InvoiceWhereInput = { AND: [where, { status: { not: "CANCELLED" } }] };
  const [all, late] = await Promise.all([
    db.invoice.aggregate({ where: live, _sum: { totalDue: true, amountPaid: true }, _count: { _all: true } }),
    db.invoice.aggregate({
      where: { AND: [where, { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: today } }] },
      _sum: { totalDue: true, amountPaid: true },
      _count: { _all: true },
    }),
  ]);
  const m = (v: Prisma.Decimal | null) => (v ? (toMinor(v) ?? 0) : 0);
  const billed = m(all._sum.totalDue);
  const paid = m(all._sum.amountPaid);
  return {
    count: all._count._all,
    billed,
    paid,
    outstanding: billed - paid,
    overdue: m(late._sum.totalDue) - m(late._sum.amountPaid),
    overdueCount: late._count._all,
    rate: billed === 0 ? null : paid / billed,
  };
}

/** The Prisma filter for a displayed status, including the derived OVERDUE. */
export function invoiceStatusWhere(status: string | undefined, today: Date): Prisma.InvoiceWhereInput {
  switch (status) {
    case "OVERDUE":
      return { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: today } };
    case "ISSUED":
    case "PARTIALLY_PAID":
      return { status, dueDate: { gte: today } };
    case "PAID":
    case "CANCELLED":
      return { status };
    case "OPEN":
      return { status: { in: ["ISSUED", "PARTIALLY_PAID"] } };
    default:
      return {};
  }
}

export const INVOICE_STATUS_FILTERS = ["OPEN", "OVERDUE", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;
