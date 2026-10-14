"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditContextFor, type RequestContext } from "@/lib/guard";
import { createAnnouncement, deleteAnnouncement, MessagingError, updateAnnouncement, viewerFor } from "@/lib/messaging/data";
import type { MessagingRole } from "@/lib/messaging/rules";
import { runAction, UserFacingError } from "@/lib/run-action";
import { approvalRequired } from "@/lib/approvals/engine";
import { approvalGate, approvalUserError } from "@/lib/approvals/gate";
import { idSchema } from "@/lib/validation/common";
import { announcementSchema } from "@/lib/validation/messaging";

/** Announcements (Phase 4.4): admins post to anyone; teachers to classes they teach. Audited. */

async function context(ctx: RequestContext) {
  const audit = auditContextFor(ctx);
  const viewer = await viewerFor(audit.tenantId, { id: ctx.user.id, role: ctx.user.role as MessagingRole });
  return { viewer, meta: { ipAddress: audit.ipAddress ?? null, userAgent: audit.userAgent ?? null, impersonatorId: audit.impersonatorId ?? null } };
}

async function friendly(err: unknown): Promise<never> {
  if (err instanceof MessagingError) {
    const t = await getTranslations("announcements.errors");
    throw new UserFacingError(t(err.code));
  }
  throw err;
}

export async function createAnnouncementAction(input: unknown) {
  return runAction(["announcement", "create"], async (ctx) => {
    const data = announcementSchema.parse(input);
    const { viewer, meta } = await context(ctx);
    // Phase 8.2: a teacher's announcement to the whole school or a role goes to an admin for approval,
    // when the school allows it; otherwise teachers post to their own classes only, as before.
    if (ctx.user.role === "TEACHER" && data.audienceScope !== "CLASS" && !data.isPinned && ctx.user.tenantId && (await approvalRequired(ctx.user.tenantId, "ANNOUNCEMENT_SCHOOL"))) {
      const gate = await approvalGate(ctx, "ANNOUNCEMENT_SCHOOL", data, "").catch(async (err) => {
        throw await approvalUserError(err);
      });
      if (gate) {
        revalidatePath("/approvals");
        return gate;
      }
    }
    try {
      const a = await createAnnouncement(viewer, data, meta);
      revalidatePath("/announcements");
      revalidatePath("/dashboard");
      return { id: a.id };
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function updateAnnouncementAction(id: unknown, input: unknown) {
  return runAction(["announcement", "update"], async (ctx) => {
    const data = announcementSchema.parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      await updateAnnouncement(viewer, idSchema.parse(id), data, meta);
    } catch (err) {
      return friendly(err);
    }
    revalidatePath("/announcements");
    revalidatePath("/dashboard");
  });
}

export async function deleteAnnouncementAction(id: unknown) {
  return runAction(["announcement", "delete"], async (ctx) => {
    const { viewer, meta } = await context(ctx);
    try {
      await deleteAnnouncement(viewer, idSchema.parse(id), meta);
    } catch (err) {
      return friendly(err);
    }
    revalidatePath("/announcements");
    revalidatePath("/dashboard");
  });
}
