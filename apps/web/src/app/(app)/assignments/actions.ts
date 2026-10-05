"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditContextFor, type RequestContext } from "@/lib/guard";
import { AssignmentError, assignmentViewer, attachWorksheet, createAssignments, deleteAssignment, removeWorksheet, requestUpload, setAssignmentStatus, updateAssignment } from "@/lib/assignments/data";
import type { AnyRole } from "@/lib/assignments/rules";
import { runAction, UserFacingError } from "@/lib/run-action";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";
import { assignmentCreateSchema, assignmentEditSchema, grantSchema, uploadRequestSchema } from "@/lib/validation/assignments";
import { zonedLocalToUtc } from "@/lib/zoned-time";

/** Assignments (Phase 5.1): teachers set work for the classes they teach; admins for any. Audited. */

async function context(ctx: RequestContext) {
  const audit = auditContextFor(ctx);
  const viewer = await assignmentViewer(audit.tenantId, { id: ctx.user.id, role: ctx.user.role as AnyRole });
  return { viewer, meta: { ipAddress: audit.ipAddress ?? null, userAgent: audit.userAgent ?? null, impersonatorId: audit.impersonatorId ?? null } };
}

async function friendly(err: unknown): Promise<never> {
  if (err instanceof AssignmentError) {
    const t = await getTranslations("assignments.errors");
    throw new UserFacingError(t(err.code));
  }
  throw err;
}

async function dueFrom(ctx: RequestContext, local: string): Promise<Date> {
  const settings = await getSettingsForUser(ctx.user.tenantId ?? null);
  const due = zonedLocalToUtc(local, settings.timezone);
  if (!due) {
    const t = await getTranslations();
    throw new UserFacingError(t("actionErrors.invalid"), { dueAt: t("validation.invalidDate") });
  }
  return due;
}

function refresh(id?: string) {
  revalidatePath("/assignments");
  if (id) revalidatePath(`/assignments/${id}`);
  revalidatePath("/dashboard");
}

export async function createAssignmentAction(input: unknown) {
  return runAction(["assignment", "create"], async (ctx) => {
    const data = assignmentCreateSchema.parse(input);
    const dueAt = await dueFrom(ctx, data.dueAt);
    const { viewer, meta } = await context(ctx);
    try {
      const ids = await createAssignments(viewer, { ...data, dueAt, maxScore: data.maxScore ?? null }, meta);
      refresh();
      return { ids };
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function updateAssignmentAction(id: unknown, input: unknown) {
  return runAction(["assignment", "update"], async (ctx) => {
    const aid = idSchema.parse(id);
    const data = assignmentEditSchema.parse(input);
    const dueAt = await dueFrom(ctx, data.dueAt);
    const { viewer, meta } = await context(ctx);
    try {
      await updateAssignment(viewer, aid, { ...data, dueAt, maxScore: data.maxScore ?? null }, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(aid);
  });
}

export async function setAssignmentStatusAction(id: unknown, to: unknown) {
  return runAction(["assignment", "update"], async (ctx) => {
    const aid = idSchema.parse(id);
    const status = to === "PUBLISHED" || to === "CLOSED" ? to : null;
    if (!status) throw new UserFacingError((await getTranslations("actionErrors"))("invalid"));
    const { viewer, meta } = await context(ctx);
    try {
      await setAssignmentStatus(viewer, aid, status, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(aid);
  });
}

export async function deleteAssignmentAction(id: unknown) {
  return runAction(["assignment", "delete"], async (ctx) => {
    const aid = idSchema.parse(id);
    const { viewer, meta } = await context(ctx);
    try {
      await deleteAssignment(viewer, aid, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh();
  });
}

/** Step 1 of attaching a worksheet: a one-time upload link plus a signed grant. */
export async function requestWorksheetUploadAction(input: unknown) {
  return runAction(["assignment", "update"], async (ctx) => {
    const data = uploadRequestSchema.parse(input);
    const { viewer } = await context(ctx);
    try {
      return await requestUpload(viewer, { ...data, kind: "worksheet" });
    } catch (err) {
      return friendly(err);
    }
  });
}

/** Step 2: the file has been uploaded; check it and attach it. */
export async function attachWorksheetAction(assignmentId: unknown, grant: unknown) {
  return runAction(["assignment", "update"], async (ctx) => {
    const aid = idSchema.parse(assignmentId);
    const { viewer, meta } = await context(ctx);
    try {
      await attachWorksheet(viewer, aid, grantSchema.parse(grant), meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(aid);
  });
}

export async function removeWorksheetAction(assignmentId: unknown, fileId: unknown) {
  return runAction(["assignment", "update"], async (ctx) => {
    const aid = idSchema.parse(assignmentId);
    const { viewer, meta } = await context(ctx);
    try {
      await removeWorksheet(viewer, idSchema.parse(fileId), meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(aid);
  });
}
