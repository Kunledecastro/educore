"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { auditContextFor, type RequestContext } from "@/lib/guard";
import {
  attachDocument,
  HealthError,
  healthViewer,
  removeDocument,
  requestDocumentUpload,
  saveContacts,
  saveHealthSettings,
  saveProfile,
  verifyProfile,
  withdrawConsent,
} from "@/lib/health/data";
import { runAction, UserFacingError } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";

/**
 * Student health (Phase 7.0). Used by the clinic (nurse) and by parents for
 * their own children. The permission matrix gates the action; the health
 * module then checks the pupil relationship and logs every read.
 */

async function context(ctx: RequestContext) {
  const a = auditContextFor(ctx);
  const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
  return { viewer, meta: { ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null } };
}

async function friendly(err: unknown): Promise<never> {
  if (err instanceof HealthError) throw new UserFacingError((await getTranslations("health.errors"))(err.code));
  throw err;
}

function refresh(studentId?: string) {
  revalidatePath("/clinic", "layout");
  revalidatePath("/health", "layout");
  if (studentId) revalidatePath(`/clinic/${studentId}`);
}

export async function saveProfileAction(studentId: unknown, input: unknown) {
  return runAction(["healthRecord", "update"], async (ctx) => {
    const sid = idSchema.parse(studentId);
    const body = z.object({ data: z.unknown(), consent: z.boolean().default(false), verify: z.boolean().default(false) }).parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      const status = await saveProfile(viewer, sid, { data: body.data, consent: body.consent, verify: body.verify }, meta);
      refresh(sid);
      return { status };
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function verifyProfileAction(studentId: unknown) {
  return runAction(["healthRecord", "update"], async (ctx) => {
    const sid = idSchema.parse(studentId);
    const { viewer, meta } = await context(ctx);
    try {
      await verifyProfile(viewer, sid, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(sid);
  });
}

export async function withdrawConsentAction(studentId: unknown) {
  return runAction(["healthRecord", "update"], async (ctx) => {
    const sid = idSchema.parse(studentId);
    const { viewer, meta } = await context(ctx);
    try {
      await withdrawConsent(viewer, sid, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(sid);
  });
}

export async function saveContactsAction(studentId: unknown, contacts: unknown) {
  return runAction(["healthRecord", "update"], async (ctx) => {
    const sid = idSchema.parse(studentId);
    const { viewer, meta } = await context(ctx);
    try {
      await saveContacts(viewer, sid, contacts, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(sid);
  });
}

export async function requestHealthDocumentUploadAction(studentId: unknown, input: unknown) {
  return runAction(["healthRecord", "update"], async (ctx) => {
    const sid = idSchema.parse(studentId);
    const data = z.object({ fileName: z.string().trim().min(1).max(200), contentType: z.string().max(100), sizeBytes: z.number().int().positive() }).parse(input);
    const { viewer } = await context(ctx);
    try {
      return await requestDocumentUpload(viewer, sid, data);
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function attachHealthDocumentAction(studentId: unknown, grant: unknown) {
  return runAction(["healthRecord", "update"], async (ctx) => {
    const sid = idSchema.parse(studentId);
    const { viewer, meta } = await context(ctx);
    try {
      await attachDocument(viewer, sid, z.string().min(10).max(2000).parse(grant), meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(sid);
  });
}

export async function removeHealthDocumentAction(documentId: unknown) {
  return runAction(["healthRecord", "update"], async (ctx) => {
    const { viewer, meta } = await context(ctx);
    try {
      await removeDocument(viewer, idSchema.parse(documentId), meta);
    } catch (err) {
      return friendly(err);
    }
    refresh();
  });
}

export async function saveHealthSettingsAction(input: unknown) {
  return runAction(["healthSettings", "update"], async (ctx) => {
    const data = z.object({ adminFullAccess: z.boolean(), retentionYears: z.number().int().min(0).max(10) }).parse(input);
    const { viewer, meta } = await context(ctx);
    try {
      await saveHealthSettings(viewer, data, meta);
    } catch (err) {
      return friendly(err);
    }
    revalidatePath("/settings/health");
    refresh();
  });
}
