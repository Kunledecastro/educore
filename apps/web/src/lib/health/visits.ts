import { z } from "zod";
import { platformPrisma, recordAudit, withRls } from "@educore/db";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { parseTenantSettings } from "../tenant-settings";
import { utcToZonedLocal, zonedLocalToUtc } from "../zoned-time";
import { auditCtx, healthConfigured, HealthError, healthKey, pupilInSchool, type HealthViewer, type Meta } from "./data";
import { healthProfileSchema, PERMITTABLE_MEDICINES } from "./profile";
import { canRecordVisit, COMPLAINTS, disallowedMedicines, isUrgent, OUTCOMES, retentionDue, visitView, type Complaint, type Outcome, type VisitView } from "./rules";

/**
 * The clinic visit log (Phase 7.2). The nurse records each visit; what
 * reports count (complaint, outcome, medicines, class, time) is stored
 * plainly, the clinical details are encrypted. Medicine can only be given
 * if the parent permitted it. Parents see their own child's visits in full;
 * teachers see only "in the clinic 10:05–10:40, back to class" for their
 * pupils; reports are counts only.
 */

export const VISIT_MEDICINES = [...PERMITTABLE_MEDICINES, "own"] as const;
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "validation.invalidDate");
const text = (max: number) => z.string().trim().max(max).default("");

export const visitInputSchema = z
  .object({
    arrivedAt: localTime,
    leftAt: localTime.or(z.literal("")).default(""),
    complaint: z.enum(COMPLAINTS),
    complaintNote: text(300),
    temperature: z.union([z.coerce.number().min(30).max(45), z.literal("")]).default(""),
    observations: text(1000),
    careGiven: text(1000),
    medicines: z
      .array(z.object({ code: z.enum(VISIT_MEDICINES), name: text(120), dose: z.string().trim().min(1).max(120), time: z.string().regex(/^\d{2}:\d{2}$/) }))
      .max(10)
      .default([]),
    outcome: z.enum(OUTCOMES).or(z.literal("")).default(""),
    outcomeNote: text(500),
  })
  .refine((v) => !v.leftAt || v.leftAt >= v.arrivedAt, { path: ["leftAt"], message: "validation.clinicLeftBeforeArrived" })
  .refine((v) => v.medicines.every((m) => m.code !== "own" || m.name.length > 0), { path: ["medicines"], message: "validation.clinicOwnNeedsName" });
export type VisitInput = z.input<typeof visitInputSchema>;

/** The encrypted part of a visit. */
interface VisitDetail {
  complaintNote: string;
  temperature: number | null;
  observations: string;
  careGiven: string;
  medicines: { code: string; name: string; dose: string; time: string }[];
  outcomeNote: string;
  recordedByName: string | null;
}

export interface VisitRow {
  id: string;
  studentId: string;
  pupil: string;
  classLabel: string;
  arrivedAt: Date;
  leftAt: Date | null;
  outcome: Outcome | null;
  urgent: boolean;
  view: Exclude<VisitView, null>;
  /** Only for the "full" view. */
  complaint: Complaint | null;
  detail: VisitDetail | null;
}

export class VisitError extends Error {
  constructor(public readonly code: "medicineNotPermitted", public readonly items: string[]) {
    super(code);
    this.name = "VisitError";
  }
}

async function tenantInfo(tenantId: string) {
  const t = await platformPrisma().tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return parseTenantSettings(t?.settings);
}

/** What the nurse may give this pupil: the parent's permitted list and their own at-school medicines. */
export async function medicineAllowance(tenantId: string, studentId: string) {
  const row = await platformPrisma().healthProfile.findFirst({ where: { tenantId, studentId }, select: { dataEnc: true } });
  if (!row) return { hasProfile: false, permitted: [] as string[], ownAtSchool: [] as string[] };
  const data = healthProfileSchema.parse(JSON.parse(decryptSecret(row.dataEnc, healthKey())));
  return { hasProfile: true, permitted: [...data.permittedMedicines], ownAtSchool: data.medications.filter((m) => m.atSchool).map((m) => m.name) };
}

/** For the visit form: who the pupil is, their alerts and what may be given. Nurse only. */
export async function visitOptions(v: HealthViewer, studentId: string) {
  if (!canRecordVisit(v)) throw new HealthError("notAllowed");
  const pupil = await pupilInSchool(v.tenantId, studentId);
  if (!pupil) throw new HealthError("notFound");
  const [allowance, contacts] = await Promise.all([
    medicineAllowance(v.tenantId, studentId),
    withRls(v.tenantId, (tx) => tx.emergencyContact.findMany({ where: { tenantId: v.tenantId, studentId }, orderBy: { priority: "asc" }, select: { name: true, relationship: true, phone: true } })),
  ]);
  return { ...allowance, contacts };
}

function parseTimes(input: z.infer<typeof visitInputSchema>, timezone: string) {
  const arrivedAt = zonedLocalToUtc(input.arrivedAt, timezone);
  const leftAt = input.leftAt ? zonedLocalToUtc(input.leftAt, timezone) : null;
  if (!arrivedAt || (input.leftAt && !leftAt)) throw new HealthError("notFound");
  return { arrivedAt, leftAt };
}

/**
 * Records (or corrects) a visit. Medicine outside the parent's permission is
 * refused. Returns whether parents should be told (always for a new visit;
 * again when an outcome is first set or becomes urgent).
 */
export async function saveVisit(v: HealthViewer, target: { studentId: string; visitId?: string | null }, raw: unknown, meta: Meta, now: Date = new Date()): Promise<{ id: string; notify: boolean }> {
  if (!canRecordVisit(v)) throw new HealthError("notAllowed");
  const input = visitInputSchema.parse(raw);
  const pupil = await pupilInSchool(v.tenantId, target.studentId);
  if (!pupil) throw new HealthError("notFound");
  const settings = await tenantInfo(v.tenantId);
  const { arrivedAt, leftAt } = parseTimes(input, settings.timezone);
  if (arrivedAt.getTime() > now.getTime() + 5 * 60_000) throw new HealthError("notFound");
  const allowance = await medicineAllowance(v.tenantId, target.studentId);
  const bad = disallowedMedicines(input.medicines, allowance);
  if (bad.length) throw new VisitError("medicineNotPermitted", bad);
  const me = await platformPrisma().user.findUnique({ where: { id: v.userId }, select: { name: true } });
  const detail: VisitDetail = {
    complaintNote: input.complaintNote,
    temperature: input.temperature === "" ? null : input.temperature,
    observations: input.observations,
    careGiven: input.careGiven,
    medicines: input.medicines,
    outcomeNote: input.outcomeNote,
    recordedByName: me?.name ?? null,
  };
  const row = {
    arrivedAt,
    leftAt,
    complaint: input.complaint,
    outcome: input.outcome || null,
    medicines: [...new Set(input.medicines.map((m) => m.code))],
    detailEnc: encryptSecret(JSON.stringify(detail), healthKey()),
    recordedById: v.userId,
  };
  return platformPrisma().$transaction(async (tx) => {
    if (target.visitId) {
      const before = await tx.clinicVisit.findFirst({ where: { id: target.visitId, tenantId: v.tenantId, studentId: target.studentId }, select: { id: true, outcome: true } });
      if (!before) throw new HealthError("notFound");
      await tx.clinicVisit.update({ where: { id: before.id }, data: row });
      await recordAudit(auditCtx(v, meta), { action: "UPDATE", entityType: "ClinicVisit", entityId: before.id, after: { studentId: target.studentId } }, tx);
      const notify = (row.outcome !== null && before.outcome === null) || (isUrgent(row.outcome) && !isUrgent(before.outcome));
      return { id: before.id, notify };
    }
    const classLabel = pupil.section ? `${pupil.section.class.name} ${pupil.section.name}` : "";
    const created = await tx.clinicVisit.create({ data: { tenantId: v.tenantId, studentId: target.studentId, classLabel, ...row } });
    await recordAudit(auditCtx(v, meta), { action: "CREATE", entityType: "ClinicVisit", entityId: created.id, after: { studentId: target.studentId } }, tx);
    return { id: created.id, notify: true };
  });
}

function decryptDetail(enc: string | null, key: Buffer): VisitDetail | null {
  return enc ? (JSON.parse(decryptSecret(enc, key)) as VisitDetail) : null;
}

type RawVisit = { id: string; studentId: string | null; classLabel: string; arrivedAt: Date; leftAt: Date | null; outcome: string | null; complaint: string; detailEnc: string | null };

function shape(r: RawVisit, view: Exclude<VisitView, null>, pupil: string, key: Buffer | null): VisitRow {
  return {
    id: r.id,
    studentId: r.studentId!,
    pupil,
    classLabel: r.classLabel,
    arrivedAt: r.arrivedAt,
    leftAt: r.leftAt,
    outcome: (r.outcome as Outcome | null) ?? null,
    urgent: isUrgent(r.outcome),
    view,
    complaint: view === "full" ? (r.complaint as Complaint) : null,
    detail: view === "full" && key ? decryptDetail(r.detailEnc, key) : null,
  };
}

/**
 * Visits for pupils this person may see, newest first. The nurse: anyone;
 * parents: their children; teachers: pupils in their sections (summary
 * only); admins: summary, or full with the school's setting.
 */
export async function listVisits(v: HealthViewer, opts: { studentId?: string; from?: Date; to?: Date; take?: number } = {}): Promise<VisitRow[]> {
  if (!healthConfigured() || v.impersonating) return [];
  const where = {
    tenantId: v.tenantId,
    studentId: opts.studentId ? opts.studentId : { not: null },
    ...(opts.from || opts.to ? { arrivedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}),
    ...(v.role === "PARENT" ? { studentId: { in: [...v.childIds].filter((id) => !opts.studentId || id === opts.studentId) } } : {}),
  };
  const rows = await platformPrisma().clinicVisit.findMany({ where, orderBy: { arrivedAt: "desc" }, take: Math.min(opts.take ?? 100, 500) });
  if (rows.length === 0) return [];
  const pupils = await withRls(v.tenantId, (tx) =>
    tx.student.findMany({ where: { tenantId: v.tenantId, id: { in: [...new Set(rows.map((r) => r.studentId!))] } }, select: { id: true, firstName: true, lastName: true, sectionId: true } }),
  );
  const byId = new Map(pupils.map((p) => [p.id, p]));
  const key = healthKey();
  const out: VisitRow[] = [];
  for (const r of rows) {
    const p = byId.get(r.studentId!);
    if (!p) continue;
    const view = visitView(v, p);
    if (view) out.push(shape(r, view, `${p.firstName} ${p.lastName}`, view === "full" ? key : null));
  }
  return out;
}

/** The nurse's day: visits that started on this local date. */
export async function dayVisits(v: HealthViewer, localDate: string) {
  const settings = await tenantInfo(v.tenantId);
  const from = zonedLocalToUtc(`${localDate}T00:00`, settings.timezone);
  if (!from) throw new HealthError("notFound");
  const to = new Date(from.getTime() + 86_400_000);
  return listVisits(v, { from, to, take: 500 });
}

// ---------------------------------------------------------------------------
// Reports — counts only, never names
// ---------------------------------------------------------------------------

export interface VisitReport {
  total: number;
  byDay: { day: string; count: number }[];
  byClass: { label: string; count: number }[];
  byComplaint: { key: Complaint; count: number }[];
  byOutcome: { key: Outcome | "OPEN"; count: number }[];
  byMedicine: { key: string; count: number }[];
}

export async function visitReport(v: HealthViewer, range: { from: string; to: string }): Promise<VisitReport> {
  if (v.impersonating || !(v.role === "SCHOOL_NURSE" || v.role === "SCHOOL_ADMIN")) throw new HealthError("notAllowed");
  const settings = await tenantInfo(v.tenantId);
  const from = zonedLocalToUtc(`${range.from}T00:00`, settings.timezone);
  const toStart = zonedLocalToUtc(`${range.to}T00:00`, settings.timezone);
  if (!from || !toStart || toStart < from) throw new HealthError("notFound");
  const to = new Date(toStart.getTime() + 86_400_000);
  const rows = await platformPrisma().clinicVisit.findMany({ where: { tenantId: v.tenantId, arrivedAt: { gte: from, lt: to } }, select: { arrivedAt: true, classLabel: true, complaint: true, outcome: true, medicines: true } });
  const count = <K extends string>(keys: K[]) => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].map(([key, n]) => ({ key, count: n })).sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
  };
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return {
    total: rows.length,
    byDay: count(rows.map((r) => day(r.arrivedAt))).map((x) => ({ day: x.key, count: x.count })).sort((a, b) => a.day.localeCompare(b.day)),
    byClass: count(rows.map((r) => r.classLabel || "—")).map((x) => ({ label: x.key, count: x.count })),
    byComplaint: count(rows.map((r) => r.complaint as Complaint)),
    byOutcome: count(rows.map((r) => (r.outcome as Outcome | null) ?? "OPEN")),
    byMedicine: count(rows.flatMap((r) => r.medicines)),
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Who to tell about a visit: the pupil's active parents. Names only — never why. */
export async function visitRecipients(tenantId: string, visitId: string) {
  const visit = await platformPrisma().clinicVisit.findFirst({ where: { id: visitId, tenantId }, select: { studentId: true, outcome: true, tenant: { select: { name: true } } } });
  if (!visit?.studentId) return null;
  const pupil = await withRls(tenantId, (tx) =>
    tx.student.findFirst({
      where: { id: visit.studentId!, tenantId },
      select: { id: true, firstName: true, lastName: true, guardians: { select: { guardian: { select: { user: { select: { id: true, email: true, name: true, isActive: true } } } } } } },
    }),
  );
  if (!pupil) return null;
  const to = pupil.guardians.map((g) => g.guardian.user).filter((u): u is NonNullable<typeof u> => Boolean(u?.isActive)).map((u) => ({ id: u.id, email: u.email, name: u.name ?? "" }));
  return { school: visit.tenant.name, pupil: `${pupil.firstName} ${pupil.lastName}`, studentId: pupil.id, urgent: isUrgent(visit.outcome), to };
}

// ---------------------------------------------------------------------------
// Retention (nightly)
// ---------------------------------------------------------------------------

/**
 * Deletes the health data of pupils who left longer ago than the school's
 * retention period: profile, documents, alerts and emergency contacts go;
 * clinic visits are anonymised (pupil and details cleared, counts kept).
 * Returns the storage keys to remove and what was done per school.
 */
export async function runHealthRetention(now: Date = new Date()) {
  const db = platformPrisma();
  const tenants = await db.tenant.findMany({ select: { id: true, settings: true } });
  const keys: string[] = [];
  const done: { tenantId: string; pupils: number }[] = [];
  for (const t of tenants) {
    const years = parseTenantSettings(t.settings).health.retentionYears;
    const left = await db.student.findMany({ where: { tenantId: t.id, status: { not: "ACTIVE" }, leftAt: { not: null } }, select: { id: true, leftAt: true } });
    const due = left.filter((s) => retentionDue(s.leftAt!, years, now)).map((s) => s.id);
    if (due.length === 0) continue;
    const [profiles, docs, alerts, visits, contacts] = await Promise.all([
      db.healthProfile.count({ where: { tenantId: t.id, studentId: { in: due } } }),
      db.healthDocument.findMany({ where: { tenantId: t.id, studentId: { in: due } }, select: { storageKey: true } }),
      db.healthAlert.count({ where: { tenantId: t.id, studentId: { in: due } } }),
      db.clinicVisit.count({ where: { tenantId: t.id, studentId: { in: due } } }),
      db.emergencyContact.count({ where: { tenantId: t.id, studentId: { in: due } } }),
    ]);
    if (profiles + docs.length + alerts + visits + contacts === 0) continue;
    await db.$transaction(async (tx) => {
      await tx.healthDocument.deleteMany({ where: { tenantId: t.id, studentId: { in: due } } });
      await tx.healthAlert.deleteMany({ where: { tenantId: t.id, studentId: { in: due } } });
      await tx.healthProfile.deleteMany({ where: { tenantId: t.id, studentId: { in: due } } });
      await tx.emergencyContact.deleteMany({ where: { tenantId: t.id, studentId: { in: due } } });
      await tx.clinicVisit.updateMany({ where: { tenantId: t.id, studentId: { in: due } }, data: { studentId: null, detailEnc: null } });
      await recordAudit({ tenantId: t.id, actorId: null }, { action: "DELETE", entityType: "HealthRetention", entityId: t.id, after: { pupils: due.length, profiles, documents: docs.length, alerts, visitsAnonymised: visits, contacts, retentionYears: years } }, tx);
    });
    keys.push(...docs.map((d) => d.storageKey));
    done.push({ tenantId: t.id, pupils: due.length });
  }
  return { keys, done };
}

/** The nurse corrects a visit: its values as the form shows them (times in the school's zone). */
export async function visitForEdit(v: HealthViewer, visitId: string) {
  if (!canRecordVisit(v)) throw new HealthError("notAllowed");
  const row = await platformPrisma().clinicVisit.findFirst({ where: { id: visitId, tenantId: v.tenantId, studentId: { not: null } } });
  if (!row) throw new HealthError("notFound");
  const settings = await tenantInfo(v.tenantId);
  const d = decryptDetail(row.detailEnc, healthKey());
  const local = (x: Date) => utcToZonedLocal(x, settings.timezone).slice(0, 16);
  return {
    studentId: row.studentId!,
    values: {
      arrivedAt: local(row.arrivedAt),
      leftAt: row.leftAt ? local(row.leftAt) : "",
      complaint: row.complaint,
      complaintNote: d?.complaintNote ?? "",
      temperature: d?.temperature != null ? String(d.temperature) : "",
      observations: d?.observations ?? "",
      careGiven: d?.careGiven ?? "",
      medicines: d?.medicines ?? [],
      outcome: row.outcome ?? "",
      outcomeNote: d?.outcomeNote ?? "",
    },
  };
}
