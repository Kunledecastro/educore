"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditContextFor, type RequestContext } from "@/lib/guard";
import { inngest } from "@/lib/inngest/client";
import { messageableStudents, MessagingError, recipientsFor, reply, startThread, viewerFor } from "@/lib/messaging/data";
import type { MessagingRole } from "@/lib/messaging/rules";
import { anyChannelEnabled } from "@/lib/notify/channels";
import { runAction, UserFacingError } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";
import { newThreadSchema, replySchema } from "@/lib/validation/messaging";
import { z } from "zod";

/** Teacher ↔ parent messages (Phase 4.4). Who may write to whom is decided in lib/messaging. */

async function context(ctx: RequestContext) {
  const audit = auditContextFor(ctx);
  const viewer = await viewerFor(audit.tenantId, { id: ctx.user.id, role: ctx.user.role as MessagingRole });
  return { viewer, meta: { ipAddress: audit.ipAddress ?? null, userAgent: audit.userAgent ?? null, impersonatorId: audit.impersonatorId ?? null } };
}

async function friendly(err: unknown): Promise<never> {
  if (err instanceof MessagingError) {
    const t = await getTranslations("messages.errors");
    throw new UserFacingError(t(err.code));
  }
  throw err;
}

/** Best effort: the message is saved either way; an email that can't be queued is just skipped. */
async function notify(tenantId: string, threadId: string, messageId: string, recipientIds: string[]) {
  if (!recipientIds.length || !anyChannelEnabled()) return;
  try {
    await inngest.send({ name: "educore/message.sent", data: { tenantId, threadId, messageId, recipientIds } });
  } catch (err) {
    console.error("[messages] could not queue notification", err);
  }
}

export async function searchStudentsAction(q: unknown) {
  return runAction(["message", "read"], async (ctx) => {
    const { viewer } = await context(ctx);
    const rows = await messageableStudents(viewer, z.string().max(60).catch("").parse(q));
    return rows.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, admissionNo: s.admissionNo, className: [s.class?.name, s.section?.name].filter(Boolean).join(" ") }));
  });
}

export async function recipientsAction(studentId: unknown) {
  return runAction(["message", "read"], async (ctx) => {
    const { viewer } = await context(ctx);
    return recipientsFor(viewer, idSchema.parse(studentId));
  });
}

export async function startThreadAction(input: unknown) {
  return runAction(["message", "create"], async (ctx) => {
    const data = newThreadSchema.parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      const r = await startThread(viewer, data, meta);
      await notify(viewer.tenantId, r.threadId, r.messageId, r.notify);
      revalidatePath("/messages");
      return { threadId: r.threadId };
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function replyAction(input: unknown) {
  return runAction(["message", "create"], async (ctx) => {
    const data = replySchema.parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      const r = await reply(viewer, data.threadId, data.body, meta);
      await notify(viewer.tenantId, data.threadId, r.messageId, r.notify);
    } catch (err) {
      return friendly(err);
    }
    revalidatePath(`/messages/${data.threadId}`);
    revalidatePath("/messages");
  });
}
