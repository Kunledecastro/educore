import "server-only";
import type { PaymentMethod, Prisma } from "@educore/db";
import { parseListParams, type SearchParamsInput } from "./list-params";

export const PAYMENT_PERIODS = ["today", "week", "month", "all"] as const;
export const PAYMENT_METHOD_FILTERS = ["CASH", "BANK_TRANSFER", "POS", "CHEQUE", "PAYSTACK"] as const;

/** First day of the period containing `today` (date-only, UTC midnight), or null for all time. */
export function periodStart(period: string | undefined, today: Date): Date | null {
  switch (period) {
    case "today":
      return today;
    case "week": {
      const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
      return new Date(today.getTime() - dow * 86_400_000);
    }
    case "month":
      return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    default:
      return null;
  }
}

/** The payments list's URL state → Prisma query (page and export share it). */
export function paymentListQuery(sp: SearchParamsInput, today: Date) {
  const params = parseListParams(sp, {
    sortable: ["paidAt", "amount", "receiptNo"] as const,
    defaultSort: "paidAt" as const,
    defaultDir: "desc",
    filters: { period: PAYMENT_PERIODS, method: PAYMENT_METHOD_FILTERS, kind: ["PAYMENT", "REVERSAL"] },
  });
  const from = periodStart(params.filters.period ?? "month", today);
  const where: Prisma.PaymentWhereInput = {
    AND: [
      from ? { paidAt: { gte: from } } : {},
      params.filters.method ? { method: params.filters.method as PaymentMethod } : {},
      params.filters.kind ? { kind: params.filters.kind as "PAYMENT" | "REVERSAL" } : {},
      params.q
        ? {
            OR: [
              { receiptNo: { contains: params.q, mode: "insensitive" } },
              { reference: { contains: params.q, mode: "insensitive" } },
              { invoice: { invoiceNo: { contains: params.q, mode: "insensitive" } } },
              { student: { firstName: { contains: params.q, mode: "insensitive" } } },
              { student: { lastName: { contains: params.q, mode: "insensitive" } } },
              { student: { admissionNo: { contains: params.q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
  const orderBy: Prisma.PaymentOrderByWithRelationInput[] =
    params.sort === "amount" ? [{ amount: params.dir }] : params.sort === "receiptNo" ? [{ receiptNo: params.dir }] : [{ paidAt: params.dir }, { createdAt: params.dir }];
  return { params, where, orderBy: [...orderBy, { id: "asc" as const }], period: params.filters.period ?? "month" };
}
