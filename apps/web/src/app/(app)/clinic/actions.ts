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
import { deleteAlert, saveAlert } from "@/lib/health/alerts";
import { saveVisit, visitOptions, VisitError } from "@/lib/health/visits";
import { inngest } from "@/lib/inngest/client";
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

/** The nurse adds or edits a pupil's alert (Phase 7.1). */
export async function saveAlertAction(studentId: unknown, alertId: unknown, input: unknown) {
  const id = alertId == null ? null : idSchema.parse(alertId);
  return runAction(["healthAlert", id ? "update" : "create"], async (ctx) => {
    const sid = idSchema.parse(studentId);
    const { viewer, meta } = await context(ctx);
    try {
      await saveAlert(viewer, sid, id, input, meta);
    } catch (err) {
      return friendly(err);
    }
    refresh(sid);
    revalidatePath("/health-alerts");
  });
}

export async function deleteAlertAction(alertId: unknown) {
  return runAction(["healthAlert", "delete"], async (ctx) => {
    const { viewer, meta } = await context(ctx);
    try {
      await deleteAlert(viewer, idSchema.parse(alertId), meta);
    } catch (err) {
      return friendly(err);
    }
    refresh();
    revalidatePath("/health-alerts");
  });
}

/** The visit form: the pupil's permitted medicines, own medicines and contacts (nurse only, Phase 7.2). */
export async function visitOptionsAction(studentId: unknown) {
  return runAction(["clinicVisit", "create"], async (ctx) => {
    const { viewer } = await context(ctx);
    try {
      return await visitOptions(viewer, idSchema.parse(studentId));
    } catch (err) {
      return friendly(err);
    }
  });
}

/** The nurse records or corrects a clinic visit; parents are told (Phase 7.2). */
export async function saveVisitAction(studentId: unknown, visitId: unknown, input: unknown) {
  const vid = visitId == null || visitId === "" ? null : idSchema.parse(visitId);
  return runAction(["clinicVisit", vid ? "update" : "create"], async (ctx) => {
    const sid = idSchema.parse(studentId);
    const { viewer, meta } = await context(ctx);
    let result: { id: string; notify: boolean };
    try {
      result = await saveVisit(viewer, { studentId: sid, visitId: vid }, input, meta);
    } catch (err) {
      if (err instanceof VisitError) throw new UserFacingError((await getTranslations("health.visits.errors"))("medicineNotPermitted", { items: err.items.join(", ") }));
      return friendly(err);
    }
    if (result.notify) {
      await inngest.send({ name: "educore/clinic.visit", data: { tenantId: viewer.tenantId, visitId: result.id } }).catch((err) => console.error("[clinic] could not queue the parent notification", err));
    }
    refresh(sid);
    revalidatePath("/clinic/visits");
    return { id: result.id };
  });
}
