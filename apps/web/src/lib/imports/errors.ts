import { Prisma } from "@educore/db";

/** A row that fails while importing, with an i18n key (imports.issues.*) the report can show. */
export class ImportRowError extends Error {
  constructor(public readonly key: string) {
    super(key);
    this.name = "ImportRowError";
  }
}

/** Maps any error thrown while writing a row to an i18n key for the report. Never leaks internals. */
export function describeImportError(err: unknown): string {
  if (err instanceof ImportRowError) return err.key;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = String(Array.isArray(err.meta?.target) ? err.meta?.target.join(",") : (err.meta?.target ?? ""));
    if (target.includes("email")) return "imports.issues.emailTaken";
    if (target.includes("employeeId")) return "imports.issues.employeeIdTaken";
    if (target.includes("admissionNo")) return "imports.issues.admissionNoTaken";
    return "imports.issues.duplicate";
  }
  console.error("[import] row failed", err);
  return "imports.issues.rowFailed";
}
