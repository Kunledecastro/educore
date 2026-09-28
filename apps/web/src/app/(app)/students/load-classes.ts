import "server-only";
import type { TenantScopedClient } from "@educore/db";
import type { ClassOption } from "./student-form";

/** Classes (with sections) for a year, shaped for the student form. */
export async function classOptionsFor(db: TenantScopedClient, academicYearId: string): Promise<ClassOption[]> {
  const classes = await db.classGrade.findMany({
    where: { academicYearId },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sections: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  return classes;
}
