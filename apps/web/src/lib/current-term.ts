import "server-only";
import type { TenantScopedClient } from "@educore/db";
import { todayInTimeZone } from "./format";
import { resolveCurrentTerm } from "./terms";

/**
 * The active academic year and its current term, as every Phase 2 screen
 * sees them: the term the school marked current, else the one containing
 * today (in the school's time zone). Tenant-scoped client only.
 */
export async function getCurrentTerm(db: TenantScopedClient, timezone: string) {
  const year = await db.academicYear.findFirst({
    where: { isActive: true },
    include: { terms: { orderBy: { order: "asc" } } },
  });
  if (!year) return { year: null, term: null };
  const { terms, ...rest } = year;
  return { year: rest, term: resolveCurrentTerm(terms, todayInTimeZone(timezone)) };
}
