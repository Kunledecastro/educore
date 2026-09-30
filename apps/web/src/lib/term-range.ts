import "server-only";
import type { TenantScopedClient } from "@educore/db";
import { resolveCurrentTerm } from "./terms";

/**
 * The period a summary covers, chosen by `?term=`: one of the year's terms
 * (default: the current one), or the whole year when it has no terms.
 */
export async function resolveTermRange(
  db: TenantScopedClient,
  year: { id: string; name: string; startDate: Date; endDate: Date },
  termParam: string | string[] | undefined,
  today: Date,
) {
  const terms = await db.term.findMany({ where: { academicYearId: year.id }, orderBy: { order: "asc" } });
  const wanted = Array.isArray(termParam) ? termParam[0] : termParam;
  const term = terms.find((t) => t.id === wanted) ?? resolveCurrentTerm(terms, today);
  return {
    terms,
    term,
    from: term?.startDate ?? year.startDate,
    to: term?.endDate ?? year.endDate,
    label: term?.name ?? year.name,
  };
}
