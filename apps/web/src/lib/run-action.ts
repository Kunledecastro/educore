import "server-only";
import { getTranslations } from "next-intl/server";
import { ZodError } from "zod";
import { Prisma } from "@educore/db";
import type { Action, Resource } from "@educore/auth";
import { fail, ok, type ActionResult } from "./action-result";
import { ForbiddenError, requirePermission, UnauthenticatedError, type RequestContext } from "./guard";

/** The record doesn't exist — or belongs to another school, which we deliberately report the same way. */
export class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

/** A delete/change was refused because other records depend on it. `reasons` are i18n keys. */
export class InUseError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`In use: ${reasons.join(", ")}`);
    this.name = "InUseError";
  }
}

/** Expected failure with a ready-made (already translated) message for the user. */
export class UserFacingError extends Error {
  constructor(message: string, public readonly fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Unique fields we can name in a "that already exists" message. */
const DUPLICATE_FIELDS = ["email", "admissionNo", "employeeId", "code", "name"] as const;

/**
 * Wraps every Server Action: checks the permission matrix FIRST (nothing
 * runs for a role that isn't allowed), then maps expected failures to a
 * translated `ActionResult` instead of a crash. Unknown errors are logged
 * server-side and the user gets a generic message — internal details never
 * leak to the browser.
 */
export async function runAction<T>(
  permission: readonly [Resource, Action],
  fn: (ctx: RequestContext) => Promise<T>,
): Promise<ActionResult<T>> {
  const t = await getTranslations("actionErrors");
  try {
    const ctx = await requirePermission(permission[0], permission[1]);
    return ok(await fn(ctx));
  } catch (err) {
    if (err instanceof UnauthenticatedError) return fail(t("unauthenticated"));
    if (err instanceof ForbiddenError) return fail(t("forbidden"));
    if (err instanceof NotFoundError) return fail(t("notFound"));
    if (err instanceof UserFacingError) return fail(err.message, err.fieldErrors);
    if (err instanceof InUseError) {
      const tb = await getTranslations("blockers");
      return fail(t("inUse", { reasons: err.reasons.map((r) => tb(r)).join(", ") }));
    }
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      const tv = await getTranslations();
      for (const issue of err.issues) {
        const key = issue.path.join(".") || "_form";
        if (!(key in fieldErrors)) fieldErrors[key] = issue.message.startsWith("validation.") ? tv(issue.message as never) : issue.message;
      }
      return fail(t("invalid"), fieldErrors);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        // Point at the field that clashed (e.g. admission number, email) when we can tell which.
        const target = err.meta?.target;
        const fields = (Array.isArray(target) ? target.map(String) : [String(target ?? "")]).join(" ");
        const fieldErrors: Record<string, string> = {};
        for (const f of DUPLICATE_FIELDS) if (fields.includes(f)) fieldErrors[f] = t(`duplicateField.${f}`);
        return fail(t("duplicate"), Object.keys(fieldErrors).length ? fieldErrors : undefined);
      }
      if (err.code === "P2025") return fail(t("notFound"));
      if (err.code === "P2003") return fail(t("inUseGeneric"));
    }
    console.error("[action] unexpected error", err);
    return fail(t("unexpected"));
  }
}
