import "server-only";
import type { Prisma, TenantScopedClient } from "@educore/db";
import { INVOICE_STATUS_FILTERS, invoiceStatusWhere } from "./fee-summary";
import { parseListParams, type SearchParamsInput } from "./list-params";

/**
 * The invoices list's URL state → Prisma query. Shared by the page and the
 * export, so you export exactly what you're looking at. `scope` is the
 * caller's student row scope (parents: their children).
 */
export async function invoiceListQuery(
  db: TenantScopedClient,
  sp: SearchParamsInput,
  opts: { termId: string | null; academicYearId: string | null; today: Date; scope: Prisma.StudentWhereInput },
) {
  const classes = opts.academicYearId
    ? await db.classGrade.findMany({ where: { academicYearId: opts.academicYearId }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } })
    : [];
  const params = parseListParams(sp, {
    sortable: ["invoiceNo", "student", "dueDate", "total"] as const,
    defaultSort: "invoiceNo" as const,
    defaultDir: "desc",
    filters: { status: INVOICE_STATUS_FILTERS, classId: classes.map((c) => c.id) },
  });
  const where: Prisma.InvoiceWhereInput = {
    AND: [
      { student: opts.scope },
      opts.termId ? { termId: opts.termId } : {},
      params.filters.classId ? { student: { classId: params.filters.classId } } : {},
      invoiceStatusWhere(params.filters.status, opts.today),
      params.q
        ? {
            OR: [
              { invoiceNo: { contains: params.q, mode: "insensitive" } },
              { student: { firstName: { contains: params.q, mode: "insensitive" } } },
              { student: { lastName: { contains: params.q, mode: "insensitive" } } },
              { student: { admissionNo: { contains: params.q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] =
    params.sort === "student"
      ? [{ student: { lastName: params.dir } }, { student: { firstName: params.dir } }]
      : params.sort === "dueDate"
        ? [{ dueDate: params.dir }]
        : params.sort === "total"
          ? [{ totalDue: params.dir }]
          : [{ invoiceNo: params.dir }];
  return { params, where, orderBy: [...orderBy, { id: "asc" as const }], classes };
}
