import type { AcademicYear, TenantScopedClient } from "@educore/db";

/**
 * Architecture rule #4: academic data is always viewed through one year.
 * Pages default to the school's ACTIVE year; `?year=<id>` lets an admin look
 * at another year. An id that isn't one of this school's years is ignored
 * (the list is already tenant-scoped, so another school's id never matches).
 */
export async function resolveAcademicYear(
  db: TenantScopedClient,
  yearParam: string | string[] | undefined,
): Promise<{ years: AcademicYear[]; selected: AcademicYear | null }> {
  const years = await db.academicYear.findMany({ orderBy: { startDate: "desc" } });
  const wanted = Array.isArray(yearParam) ? yearParam[0] : yearParam;
  const selected =
    years.find((y) => y.id === wanted) ?? years.find((y) => y.isActive) ?? years[0] ?? null;
  return { years, selected };
}
