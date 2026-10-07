import { createHash, randomBytes } from "node:crypto";
import { platformPrisma, recordAudit, withRls, type Prisma } from "@educore/db";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { readGrant, safeFileName, signGrant, sniffType, typeMatches, type UploadGrant } from "../storage/files";
import { MAX_FILE_BYTES } from "../storage/file-types";
import { objectStore, scanUpload, type ObjectStore } from "../storage/object-store";
import { parseTenantSettings } from "../tenant-settings";
import { CONSENT_VERSION, emergencyContactsSchema, healthProfileSchema, isEmptyProfile, type EmergencyContactInput, type HealthProfileData } from "./profile";
import { canEditRecord, canOpenRecord, canSeeList, canVerify, statusAfterSave, type HealthActor, type ProfileStatus } from "./rules";

/**
 * Student health, server side (Phase 7.0). The health tables can't be read
 * by the app's database role at all; this module is the only way in. Every
 * function checks the school, the role and the relationship to the pupil
 * (rules.ts); every read of a full record or document is written to the
 * health access log in the same transaction; medical details are encrypted
 * with HEALTH_DATA_KEY. The school's ordinary audit log records that a
 * change happened and by whom — never the health details themselves.
 */

export class HealthError extends Error {
  constructor(public readonly code: "notConfigured" | "notFound" | "notAllowed" | "consentRequired" | "empty" | "badFile" | "tooLarge" | "uploadMissing" | "storageOff" | "tooManyFiles") {
    super(code);
    this.name = "HealthError";
  }
}

export interface Meta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface HealthViewer extends HealthActor {
  tenantId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Health data has its own key; without it the module refuses to store anything (no silent fallback). */
export function healthKey(env: Record<string, string | undefined> = process.env): Buffer {
  const k = env.HEALTH_DATA_KEY;
  if (!k || k.length < 16) throw new HealthError("notConfigured");
  return createHash("sha256").update(`educore:health-data:${k}`).digest();
}

export function healthConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.HEALTH_DATA_KEY && env.HEALTH_DATA_KEY.length >= 16);
}

function grantSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return `${s}:health-upload-grants`;
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

export async function healthSettings(tenantId: string) {
  const t = await platformPrisma().tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return parseTenantSettings(t?.settings).health;
}

export async function healthViewer(tenantId: string, user: { id: string; role: string }, opts: { impersonating?: boolean } = {}): Promise<HealthViewer> {
  const [settings, childIds] = await Promise.all([
    healthSettings(tenantId),
    user.role === "PARENT"
      ? withRls(tenantId, async (tx) => {
          const g = await tx.guardian.findFirst({ where: { tenantId, userId: user.id }, select: { students: { select: { studentId: true, student: { select: { status: true } } } } } });
          return g?.students.filter((s) => s.student.status === "ACTIVE").map((s) => s.studentId) ?? [];
        })
      : Promise.resolve([] as string[]),
  ]);
  return { tenantId, userId: user.id, role: user.role, childIds, adminFullAccess: settings.adminFullAccess, impersonating: Boolean(opts.impersonating) };
}

async function pupilInSchool(tenantId: string, studentId: string) {
  return withRls(tenantId, (tx) =>
    tx.student.findFirst({ where: { id: studentId, tenantId }, select: { id: true, firstName: true, lastName: true, admissionNo: true, status: true, section: { select: { name: true, class: { select: { name: true } } } } } }),
  );
}

const auditCtx = (v: HealthViewer, meta: Meta) => ({ tenantId: v.tenantId, actorId: v.userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });

// ---------------------------------------------------------------------------
// Reading (always logged)
// ---------------------------------------------------------------------------

export interface HealthRecordView {
  student: { id: string; name: string; admissionNo: string; className: string | null };
  profile: null | {
    data: HealthProfileData;
    status: ProfileStatus;
    consent: { version: string; at: Date; source: "ONLINE" | "PAPER"; byName: string | null };
    submittedAt: Date | null;
    verifiedAt: Date | null;
    verifiedByName: string | null;
  };
  contacts: (EmergencyContactInput & { id: string })[];
  documents: { id: string; fileName: string; sizeBytes: number; createdAt: Date }[];
  canEdit: boolean;
  canVerify: boolean;
}

/** Opens one pupil's full record. Refused unless allowed; the opening is logged. */
export async function openRecord(v: HealthViewer, studentId: string, meta: Meta): Promise<HealthRecordView> {
  if (!canOpenRecord(v, studentId)) throw new HealthError("notFound");
  const pupil = await pupilInSchool(v.tenantId, studentId);
  if (!pupil) throw new HealthError("notFound");
  const key = healthKey();
  const db = platformPrisma();
  const [row, documents] = await db.$transaction(async (tx) => {
    await tx.healthAccessLog.create({ data: { tenantId: v.tenantId, actorId: v.userId, actorRole: v.role, studentId, action: "VIEW_RECORD", ipAddress: meta.ipAddress } });
    return Promise.all([
      tx.healthProfile.findFirst({ where: { tenantId: v.tenantId, studentId }, include: { consentBy: { select: { name: true } }, verifiedBy: { select: { name: true } } } }),
      tx.healthDocument.findMany({ where: { tenantId: v.tenantId, studentId }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, sizeBytes: true, createdAt: true } }),
    ]);
  });
  const contacts = await withRls(v.tenantId, (tx) => tx.emergencyContact.findMany({ where: { tenantId: v.tenantId, studentId }, orderBy: { priority: "asc" } }));
  return {
    student: { id: pupil.id, name: `${pupil.firstName} ${pupil.lastName}`, admissionNo: pupil.admissionNo, className: pupil.section ? `${pupil.section.class.name} ${pupil.section.name}` : null },
    profile: row
      ? {
          data: healthProfileSchema.parse(JSON.parse(decryptSecret(row.dataEnc, key))),
          status: row.status as ProfileStatus,
          consent: { version: row.consentVersion, at: row.consentAt, source: row.consentSource as "ONLINE" | "PAPER", byName: row.consentBy?.name ?? null },
          submittedAt: row.submittedAt,
          verifiedAt: row.verifiedAt,
          verifiedByName: row.verifiedBy?.name ?? null,
        }
      : null,
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, relationship: c.relationship, phone: c.phone, altPhone: c.altPhone ?? "" })),
    documents,
    canEdit: canEditRecord(v, studentId),
    canVerify: canVerify(v),
  };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export interface SaveInput {
  data: unknown;
  /** Parents: they tick the consent statement. The nurse: a signed paper form was received (first save only). */
  consent: boolean;
  /** The nurse: mark as checked. */
  verify?: boolean;
}

/**
 * Parents save their child's profile with consent; the nurse saves (and can
 * verify) any pupil's. An empty profile isn't stored. Consent is required
 * for the first save; parent changes to a checked profile flag it for the
 * nurse again.
 */
export async function saveProfile(v: HealthViewer, studentId: string, input: SaveInput, meta: Meta, now: Date = new Date()): Promise<ProfileStatus> {
  if (!canEditRecord(v, studentId)) throw new HealthError("notFound");
  const saver = v.role === "SCHOOL_NURSE" ? "SCHOOL_NURSE" : "PARENT";
  const data = healthProfileSchema.parse(input.data);
  if (isEmptyProfile(data)) throw new HealthError("empty");
  const pupil = await pupilInSchool(v.tenantId, studentId);
  if (!pupil || pupil.status !== "ACTIVE") throw new HealthError("notFound");
  const enc = encryptSecret(JSON.stringify(data), healthKey());
  const db = platformPrisma();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM students WHERE id = ${studentId} FOR UPDATE`;
    const before = await tx.healthProfile.findFirst({ where: { tenantId: v.tenantId, studentId }, select: { id: true, status: true } });
    // Parents must tick consent every time they save; the nurse records a paper form once.
    if (saver === "PARENT" && !input.consent) throw new HealthError("consentRequired");
    if (saver === "SCHOOL_NURSE" && !before && !input.consent) throw new HealthError("consentRequired");
    const status = statusAfterSave(saver, (before?.status as ProfileStatus) ?? null, Boolean(input.verify));
    const consent =
      saver === "PARENT" || !before
        ? { consentVersion: CONSENT_VERSION, consentAt: now, consentById: v.userId, consentSource: saver === "PARENT" ? "ONLINE" : "PAPER" }
        : {};
    const verified = status === "VERIFIED" && saver === "SCHOOL_NURSE" ? { verifiedById: v.userId, verifiedAt: now } : {};
    const submitted = saver === "PARENT" ? { submittedById: v.userId, submittedAt: now } : {};
    const row = before
      ? await tx.healthProfile.update({ where: { id: before.id }, data: { dataEnc: enc, status, ...consent, ...verified, ...submitted } })
      : await tx.healthProfile.create({
          data: { tenantId: v.tenantId, studentId, dataEnc: enc, status, ...(consent as { consentVersion: string; consentAt: Date; consentById: string; consentSource: string }), ...verified, ...submitted },
        });
    await recordAudit(auditCtx(v, meta), { action: before ? "UPDATE" : "CREATE", entityType: "HealthProfile", entityId: row.id, before: before ? { status: before.status } : undefined, after: { status, studentId, by: v.role } }, tx);
    return status;
  });
}

/** The nurse confirms a profile as checked, without changing it. */
export async function verifyProfile(v: HealthViewer, studentId: string, meta: Meta, now: Date = new Date()) {
  if (!canVerify(v)) throw new HealthError("notAllowed");
  await platformPrisma().$transaction(async (tx) => {
    const p = await tx.healthProfile.findFirst({ where: { tenantId: v.tenantId, studentId }, select: { id: true, status: true } });
    if (!p) throw new HealthError("notFound");
    await tx.healthProfile.update({ where: { id: p.id }, data: { status: "VERIFIED", verifiedById: v.userId, verifiedAt: now } });
    await recordAudit(auditCtx(v, meta), { action: "UPDATE", entityType: "HealthProfile", entityId: p.id, before: { status: p.status }, after: { status: "VERIFIED", studentId } }, tx);
  });
}

/** Withdrawing consent deletes the profile and documents (emergency contacts and clinic visits stay). */
export async function withdrawConsent(v: HealthViewer, studentId: string, meta: Meta, store: ObjectStore = objectStore) {
  if (!canEditRecord(v, studentId)) throw new HealthError("notFound");
  const keys = await platformPrisma().$transaction(async (tx) => {
    const p = await tx.healthProfile.findFirst({ where: { tenantId: v.tenantId, studentId }, select: { id: true } });
    const docs = await tx.healthDocument.findMany({ where: { tenantId: v.tenantId, studentId }, select: { storageKey: true } });
    if (!p && docs.length === 0) throw new HealthError("notFound");
    await tx.healthDocument.deleteMany({ where: { tenantId: v.tenantId, studentId } });
    if (p) await tx.healthProfile.delete({ where: { id: p.id } });
    await recordAudit(auditCtx(v, meta), { action: "DELETE", entityType: "HealthProfile", entityId: p?.id ?? studentId, after: { consent: "withdrawn", studentId, by: v.role } }, tx);
    return docs.map((d) => d.storageKey);
  });
  if (keys.length && store.configured()) await store.remove(keys).catch((err) => console.error("[health] could not remove documents", err));
}

/** Emergency contacts: not health data, kept without consent; parents (own child) and the nurse. */
export async function saveContacts(v: HealthViewer, studentId: string, contacts: unknown, meta: Meta) {
  if (!canEditRecord(v, studentId)) throw new HealthError("notFound");
  const list = emergencyContactsSchema.parse(contacts);
  const pupil = await pupilInSchool(v.tenantId, studentId);
  if (!pupil) throw new HealthError("notFound");
  await withRls(v.tenantId, async (tx) => {
    const before = await tx.emergencyContact.count({ where: { tenantId: v.tenantId, studentId } });
    await tx.emergencyContact.deleteMany({ where: { tenantId: v.tenantId, studentId } });
    if (list.length) {
      await tx.emergencyContact.createMany({
        data: list.map((c, i) => ({ tenantId: v.tenantId, studentId, name: c.name, relationship: c.relationship, phone: c.phone, altPhone: c.altPhone || null, priority: i })),
      });
    }
    await recordAudit(auditCtx(v, meta), { action: "UPDATE", entityType: "EmergencyContact", entityId: studentId, before: { count: before }, after: { count: list.length, by: v.role } }, tx);
  });
}

// ---------------------------------------------------------------------------
// The clinic list (statuses only — no health details, so not logged)
// ---------------------------------------------------------------------------

export type ListStatus = "none" | ProfileStatus;

export async function clinicList(v: HealthViewer, opts: { q?: string; classId?: string; status?: ListStatus; skip?: number; take?: number } = {}) {
  if (!canSeeList(v)) throw new HealthError("notAllowed");
  const db = platformPrisma();
  const profiles = await db.healthProfile.findMany({ where: { tenantId: v.tenantId }, select: { studentId: true, status: true, updatedAt: true } });
  const statusOf = new Map(profiles.map((p) => [p.studentId, p]));
  const ids = profiles.filter((p) => !opts.status || opts.status === "none" || p.status === opts.status).map((p) => p.studentId);
  const where: Prisma.StudentWhereInput = {
    tenantId: v.tenantId,
    status: "ACTIVE",
    ...(opts.classId ? { classId: opts.classId } : {}),
    ...(opts.q ? { OR: [{ firstName: { contains: opts.q, mode: "insensitive" } }, { lastName: { contains: opts.q, mode: "insensitive" } }, { admissionNo: { contains: opts.q, mode: "insensitive" } }] } : {}),
    ...(opts.status === "none" ? { id: { notIn: profiles.map((p) => p.studentId) } } : opts.status ? { id: { in: ids } } : {}),
  };
  const [rows, total, counts, contactCounts] = await Promise.all([
    withRls(v.tenantId, (tx) =>
      tx.student.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip: opts.skip ?? 0,
        take: opts.take ?? 25,
        select: { id: true, firstName: true, lastName: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } },
      }),
    ),
    withRls(v.tenantId, (tx) => tx.student.count({ where })),
    withRls(v.tenantId, (tx) => tx.student.count({ where: { tenantId: v.tenantId, status: "ACTIVE" } })),
    withRls(v.tenantId, (tx) => tx.emergencyContact.groupBy({ by: ["studentId"], where: { tenantId: v.tenantId }, _count: { _all: true } })),
  ]);
  const withContacts = new Set(contactCounts.map((c) => c.studentId));
  const active = await withRls(v.tenantId, (tx) => tx.student.findMany({ where: { tenantId: v.tenantId, status: "ACTIVE" }, select: { id: true } }));
  const activeIds = new Set(active.map((a) => a.id));
  const summary = { pupils: counts, none: 0, SUBMITTED: 0, VERIFIED: 0, CHANGED: 0 } as Record<"pupils" | ListStatus, number>;
  for (const p of profiles) if (activeIds.has(p.studentId)) summary[p.status as ProfileStatus]++;
  summary.none = counts - summary.SUBMITTED - summary.VERIFIED - summary.CHANGED;
  return {
    total,
    summary,
    canOpen: canOpenRecord(v, "__any__") || v.role === "SCHOOL_NURSE",
    rows: rows.map((s) => ({
      id: s.id,
      name: `${s.firstName} ${s.lastName}`,
      admissionNo: s.admissionNo,
      className: s.section ? `${s.section.class.name} ${s.section.name}` : null,
      status: (statusOf.get(s.id)?.status as ProfileStatus | undefined) ?? ("none" as const),
      updatedAt: statusOf.get(s.id)?.updatedAt ?? null,
      hasContacts: withContacts.has(s.id),
    })),
  };
}

/** Parents: their children, each with the profile's status. */
export async function familyHealthList(v: HealthViewer) {
  if (v.role !== "PARENT" || v.childIds.length === 0) return [];
  const [pupils, profiles] = await Promise.all([
    withRls(v.tenantId, (tx) => tx.student.findMany({ where: { tenantId: v.tenantId, id: { in: [...v.childIds] } }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } })),
    platformPrisma().healthProfile.findMany({ where: { tenantId: v.tenantId, studentId: { in: [...v.childIds] } }, select: { studentId: true, status: true } }),
  ]);
  return pupils.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, status: (profiles.find((x) => x.studentId === p.id)?.status as ProfileStatus | undefined) ?? ("none" as const) }));
}

/** School admins: who opened whose record, and when (never the content). */
export async function accessLog(v: HealthViewer, opts: { studentId?: string; skip?: number; take?: number } = {}) {
  if (v.role !== "SCHOOL_ADMIN") throw new HealthError("notAllowed");
  const where = { tenantId: v.tenantId, ...(opts.studentId ? { studentId: opts.studentId } : {}) };
  const db = platformPrisma();
  const [rows, total] = await Promise.all([
    db.healthAccessLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: opts.skip ?? 0, take: opts.take ?? 50, include: { actor: { select: { name: true, email: true } } } }),
    db.healthAccessLog.count({ where }),
  ]);
  const names = await withRls(v.tenantId, (tx) => tx.student.findMany({ where: { tenantId: v.tenantId, id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, firstName: true, lastName: true } }));
  return {
    total,
    rows: rows.map((r) => ({ id: r.id, at: r.createdAt, action: r.action, actor: r.actor?.name ?? r.actor?.email ?? "—", actorRole: r.actorRole, pupil: names.find((n) => n.id === r.studentId) ? `${names.find((n) => n.id === r.studentId)!.firstName} ${names.find((n) => n.id === r.studentId)!.lastName}` : "—", ipAddress: r.ipAddress })),
  };
}

/** School admins: the health settings. */
export async function saveHealthSettings(v: HealthViewer, next: { adminFullAccess: boolean; retentionYears: number }, meta: Meta) {
  if (v.role !== "SCHOOL_ADMIN" || v.impersonating) throw new HealthError("notAllowed");
  await platformPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${v.tenantId} FOR UPDATE`;
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: v.tenantId }, select: { settings: true } });
    const raw = t.settings && typeof t.settings === "object" && !Array.isArray(t.settings) ? (t.settings as Record<string, unknown>) : {};
    const before = parseTenantSettings(raw).health;
    await tx.tenant.update({ where: { id: v.tenantId }, data: { settings: { ...raw, health: next } as unknown as Prisma.InputJsonValue } });
    await recordAudit(auditCtx(v, meta), { action: "UPDATE", entityType: "Tenant", entityId: v.tenantId, before: { health: before }, after: { health: next } }, tx);
  });
}

// ---------------------------------------------------------------------------
// Documents (doctor's letters, immunisation cards)
// ---------------------------------------------------------------------------

const HEALTH_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const MAX_HEALTH_DOCUMENTS = 10;

export async function requestDocumentUpload(
  v: HealthViewer,
  studentId: string,
  input: { fileName: string; contentType: string; sizeBytes: number },
  store: ObjectStore = objectStore,
  now: number = Date.now(),
): Promise<{ uploadUrl: string; grant: string }> {
  if (!canEditRecord(v, studentId)) throw new HealthError("notFound");
  if (!store.configured()) throw new HealthError("storageOff");
  if (!HEALTH_TYPES.has(input.contentType)) throw new HealthError("badFile");
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_FILE_BYTES) throw new HealthError("tooLarge");
  const pupil = await pupilInSchool(v.tenantId, studentId);
  if (!pupil) throw new HealthError("notFound");
  const hasProfile = await platformPrisma().healthProfile.count({ where: { tenantId: v.tenantId, studentId } });
  if (!hasProfile) throw new HealthError("consentRequired"); // documents belong with a consented profile
  const n = await platformPrisma().healthDocument.count({ where: { tenantId: v.tenantId, studentId } });
  if (n >= MAX_HEALTH_DOCUMENTS) throw new HealthError("tooManyFiles");
  const type = input.contentType as "application/pdf" | "image/jpeg" | "image/png";
  const name = safeFileName(input.fileName, type);
  const key = `${v.tenantId}/health/${studentId}/${randomBytes(12).toString("hex")}-${name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(0, 60)}`;
  await withRls(v.tenantId, (tx) => tx.pendingUpload.create({ data: { tenantId: v.tenantId, storageKey: key, userId: v.userId } }));
  const grant = signGrant({ key, userId: v.userId, assignmentId: `health:${studentId}`, contentType: type, fileName: name, expiresAt: now + 2 * 3600_000 }, grantSecret());
  return { uploadUrl: await store.createUploadUrl(key), grant };
}

export async function attachDocument(v: HealthViewer, studentId: string, token: string, meta: Meta, store: ObjectStore = objectStore, now: number = Date.now()) {
  if (!canEditRecord(v, studentId)) throw new HealthError("notFound");
  const g: UploadGrant | null = readGrant(token, grantSecret(), now);
  if (!g || g.userId !== v.userId || g.assignmentId !== `health:${studentId}` || !g.key.startsWith(`${v.tenantId}/health/${studentId}/`)) throw new HealthError("badFile");
  const head = await store.inspect(g.key);
  if (!head) throw new HealthError("uploadMissing");
  const reject = async (code: "badFile" | "tooLarge") => {
    await store.remove([g.key]).catch(() => undefined);
    throw new HealthError(code);
  };
  if (head.sizeBytes <= 0 || head.sizeBytes > MAX_FILE_BYTES) return reject("tooLarge");
  if (!typeMatches(g.contentType, sniffType(head.head))) return reject("badFile");
  if (!(await scanUpload(g.key))) return reject("badFile");
  await platformPrisma().$transaction(async (tx) => {
    const n = await tx.healthDocument.count({ where: { tenantId: v.tenantId, studentId } });
    if (n >= MAX_HEALTH_DOCUMENTS) throw new HealthError("tooManyFiles");
    const doc = await tx.healthDocument.upsert({
      where: { storageKey: g.key },
      create: { tenantId: v.tenantId, studentId, storageKey: g.key, fileName: g.fileName, contentType: g.contentType, sizeBytes: head.sizeBytes, uploadedById: v.userId },
      update: {},
    });
    await tx.pendingUpload.deleteMany({ where: { tenantId: v.tenantId, storageKey: g.key } }); // same transaction: never "pending" once attached
    await recordAudit(auditCtx(v, meta), { action: "CREATE", entityType: "HealthDocument", entityId: doc.id, after: { studentId, by: v.role } }, tx);
  });
}

export async function removeDocument(v: HealthViewer, documentId: string, meta: Meta, store: ObjectStore = objectStore) {
  const doc = await platformPrisma().healthDocument.findFirst({ where: { id: documentId, tenantId: v.tenantId } });
  if (!doc || !canEditRecord(v, doc.studentId)) throw new HealthError("notFound");
  await platformPrisma().$transaction(async (tx) => {
    await tx.healthDocument.delete({ where: { id: doc.id } });
    await recordAudit(auditCtx(v, meta), { action: "DELETE", entityType: "HealthDocument", entityId: doc.id, after: { studentId: doc.studentId, by: v.role } }, tx);
  });
  if (store.configured()) await store.remove([doc.storageKey]).catch((err) => console.error("[health] could not remove document", err));
}

/** A five-minute link to a document; the opening is logged. */
export async function documentLink(v: HealthViewer, documentId: string, meta: Meta, store: ObjectStore = objectStore): Promise<string> {
  if (!store.configured()) throw new HealthError("storageOff");
  const doc = await platformPrisma().healthDocument.findFirst({ where: { id: documentId, tenantId: v.tenantId } });
  if (!doc || !canOpenRecord(v, doc.studentId)) throw new HealthError("notFound");
  await platformPrisma().healthAccessLog.create({ data: { tenantId: v.tenantId, actorId: v.userId, actorRole: v.role, studentId: doc.studentId, action: "VIEW_DOCUMENT", ipAddress: meta.ipAddress } });
  return store.createDownloadUrl(doc.storageKey, doc.fileName, 300);
}
