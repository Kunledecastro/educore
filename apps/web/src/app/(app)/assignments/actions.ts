"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditContextFor, type RequestContext } from "@/lib/guard";
import { AssignmentError, assignmentViewer, attachWorksheet, createAssignments, deleteAssignment, removeWorksheet, requestUpload, setAssignmentStatus, updateAssignment } from "@/lib/assignments/data";
import type { AnyRole } from "@/lib/assignments/rules";
import { handIn, markMissing, markSubmission, recordWork, releaseMarks, returnSubmission, saveAssignmentSettings } from "@/lib/assignments/submissions";
import { inngest } from "@/lib/inngest/client";
import { runAction, UserFacingError } from "@/lib/run-action";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";
import { assignmentCreateSchema, assignmentEditSchema, assignmentSettingsSchema, grantSchema, handInSchema, markSchema, returnSchema, uploadRequestSchema } from "@/lib/validation/assignments";
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

// ---------------------------------------------------------------------------
// Phase 5.2: handing in and marking
// ---------------------------------------------------------------------------

/** Tell families, in the background. A failure to queue never undoes the change itself. */
async function notifyFamilies(tenantId: string, assignmentId: string, studentIds: string[], kind: "returned" | "released") {
  if (studentIds.length === 0) return;
  try {
    await inngest.send({ name: "educore/assignment.feedback", data: { tenantId, assignmentId, studentIds, kind } });
  } catch (err) {
    console.error("[assignments] could not queue the notification", err);
  }
}

/** A pupil (or parent) asks for an upload slot for their work. */
export async function requestSubmissionUploadAction(input: unknown) {
  return runAction(["submission", "create"], async (ctx) => {
    const data = uploadRequestSchema.parse(input);
    const { viewer } = await context(ctx);
    try {
      return await requestUpload(viewer, { ...data, kind: "submission" });
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function handInAction(input: unknown) {
  return runAction(["submission", "create"], async (ctx) => {
    const data = handInSchema.parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      await handIn(viewer, data, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(data.assignmentId);
  });
}

export async function markSubmissionAction(submissionId: unknown, input: unknown) {
  return runAction(["submission", "update"], async (ctx) => {
    const data = markSchema.parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      const r = await markSubmission(viewer, idSchema.parse(submissionId), { score: data.score ?? null, feedback: data.feedback ?? null }, meta);
      refresh(r.assignmentId);
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function returnSubmissionAction(submissionId: unknown, input: unknown) {
  return runAction(["submission", "update"], async (ctx) => {
    const data = returnSchema.parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      const r = await returnSubmission(viewer, idSchema.parse(submissionId), data.feedback, meta);
      refresh(r.assignmentId);
      await notifyFamilies(viewer.tenantId, r.assignmentId, [r.studentId], "returned");
    } catch (err) {
      return friendly(err);
    }
  });
}

/** Record work handed in on paper (or seen in class), with its mark. */
export async function recordWorkAction(assignmentId: unknown, studentId: unknown, input: unknown) {
  return runAction(["submission", "create"], async (ctx) => {
    const aid = idSchema.parse(assignmentId);
    const data = markSchema.parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      await recordWork(viewer, aid, idSchema.parse(studentId), { score: data.score ?? null, feedback: data.feedback ?? null }, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(aid);
  });
}

export async function markMissingAction(assignmentId: unknown) {
  return runAction(["submission", "update"], async (ctx) => {
    const aid = idSchema.parse(assignmentId);
    const { viewer, meta } = await context(ctx);
    try {
      const count = await markMissing(viewer, aid, meta);
      refresh(aid);
      return { count };
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function releaseMarksAction(assignmentId: unknown, release: unknown) {
  return runAction(["assignment", "update"], async (ctx) => {
    const aid = idSchema.parse(assignmentId);
    const { viewer, meta } = await context(ctx);
    try {
      const r = await releaseMarks(viewer, aid, release === true, meta);
      refresh(aid);
      await notifyFamilies(viewer.tenantId, aid, r.studentIds, "released");
    } catch (err) {
      return friendly(err);
    }
  });
}

/** School admins: may parents hand work in for their children? */
export async function saveAssignmentSettingsAction(input: unknown) {
  return runAction(["assignment", "update"], async (ctx) => {
    const data = assignmentSettingsSchema.parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      await saveAssignmentSettings(viewer, data, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh();
  });
}
