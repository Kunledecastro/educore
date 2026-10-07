import { z } from "zod";
import { platformPrisma, recordAudit, withRls } from "@educore/db";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { auditCtx, healthConfigured, HealthError, healthKey, pupilInSchool, type HealthViewer, type Meta } from "./data";
import { ALERT_CATEGORIES, ALERT_SEVERITIES, canManageAlerts, canSeeAlerts, sortAlerts, type AlertCategory, type AlertSeverity } from "./rules";

/**
 * Health alerts (Phase 7.1): short, action-focused notes the nurse writes
 * ("Severe peanut allergy — EpiPen in bag; call nurse and parent"). They're
 * what teachers see next to a pupil's name — never the medical history.
 * The text is encrypted like the profile; changes are audited by category
 * and severity only.
 */

export const MAX_ALERTS_PER_PUPIL = 10;

export const alertInputSchema = z.object({
  category: z.enum(ALERT_CATEGORIES),
  severity: z.enum(ALERT_SEVERITIES),
  text: z.string().trim().min(3).max(200),
});
export type AlertInput = z.infer<typeof alertInputSchema>;

export interface AlertView {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  text: string;
  updatedAt: Date;
}

function toView(row: { id: string; category: string; severity: string; textEnc: string; updatedAt: Date }, key: Buffer): AlertView {
  return { id: row.id, category: row.category as AlertCategory, severity: row.severity as AlertSeverity, text: decryptSecret(row.textEnc, key), updatedAt: row.updatedAt };
}

/** One pupil's alerts, if this person may see them. */
export async function pupilAlerts(v: HealthViewer, studentId: string): Promise<AlertView[]> {
  const pupil = await pupilInSchool(v.tenantId, studentId);
  if (!pupil || !canSeeAlerts(v, pupil)) throw new HealthError("notFound");
  const key = healthKey();
  const rows = await platformPrisma().healthAlert.findMany({ where: { tenantId: v.tenantId, studentId } });
  return sortAlerts(rows.map((r) => toView(r, key)));
}

/**
 * Alerts for a set of pupils (registers, gradebooks, class lists), keyed by
 * pupil. Pupils this person may not see are simply left out. Never throws
 * for "health not set up" — the page just shows no badges.
 */
export async function alertsFor(v: HealthViewer, studentIds: readonly string[]): Promise<Record<string, AlertView[]>> {
  if (!healthConfigured() || studentIds.length === 0 || v.impersonating) return {};
  const pupils = await withRls(v.tenantId, (tx) => tx.student.findMany({ where: { tenantId: v.tenantId, id: { in: [...studentIds] } }, select: { id: true, sectionId: true } }));
  const allowed = pupils.filter((p) => canSeeAlerts(v, p)).map((p) => p.id);
  if (allowed.length === 0) return {};
  const key = healthKey();
  const rows = await platformPrisma().healthAlert.findMany({ where: { tenantId: v.tenantId, studentId: { in: allowed } } });
  const out: Record<string, AlertView[]> = {};
  for (const r of rows) (out[r.studentId] ??= []).push(toView(r, key));
  for (const id of Object.keys(out)) out[id] = sortAlerts(out[id]!);
  return out;
}

/**
 * Every pupil with alerts this person may see, grouped by class — the
 * "Health alerts" page. Teachers: their sections; nurse and admins: the
 * school.
 */
export async function alertsBoard(v: HealthViewer) {
  if (!["SCHOOL_NURSE", "SCHOOL_ADMIN", "TEACHER"].includes(v.role) || v.impersonating) throw new HealthError("notAllowed");
  if (!healthConfigured()) throw new HealthError("notConfigured");
  const withAlerts = await platformPrisma().healthAlert.findMany({ where: { tenantId: v.tenantId }, select: { studentId: true }, distinct: ["studentId"] });
  const sectionFilter = v.role === "TEACHER" ? { sectionId: { in: [...(v.sectionIds ?? [])] } } : {};
  const [pupils, sections] = await Promise.all([
    withRls(v.tenantId, (tx) =>
      tx.student.findMany({
        where: { tenantId: v.tenantId, status: "ACTIVE", id: { in: withAlerts.map((a) => a.studentId) }, ...sectionFilter },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, firstName: true, lastName: true, admissionNo: true, sectionId: true },
      }),
    ),
    withRls(v.tenantId, (tx) =>
      tx.section.findMany({
        where: { tenantId: v.tenantId, ...(v.role === "TEACHER" ? { id: { in: [...(v.sectionIds ?? [])] } } : {}), class: { academicYear: { isActive: true } } },
        orderBy: [{ class: { order: "asc" } }, { name: "asc" }],
        select: { id: true, name: true, class: { select: { name: true } } },
      }),
    ),
  ]);
  const alerts = await alertsFor(v, pupils.map((p) => p.id));
  return sections.map((s) => ({
    sectionId: s.id,
    label: `${s.class.name} ${s.name}`,
    pupils: pupils.filter((p) => p.sectionId === s.id && alerts[p.id]?.length).map((p) => ({ id: p.id, name: `${p.lastName}, ${p.firstName}`, admissionNo: p.admissionNo, alerts: alerts[p.id]! })),
  }));
}

/** The nurse adds or edits an alert. */
export async function saveAlert(v: HealthViewer, studentId: string, alertId: string | null, input: unknown, meta: Meta) {
  if (!canManageAlerts(v)) throw new HealthError("notAllowed");
  const data = alertInputSchema.parse(input);
  const pupil = await pupilInSchool(v.tenantId, studentId);
  if (!pupil || pupil.status !== "ACTIVE") throw new HealthError("notFound");
  const textEnc = encryptSecret(data.text, healthKey());
  await platformPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM students WHERE id = ${studentId} FOR UPDATE`;
    if (alertId) {
      const before = await tx.healthAlert.findFirst({ where: { id: alertId, tenantId: v.tenantId, studentId }, select: { id: true, category: true, severity: true } });
      if (!before) throw new HealthError("notFound");
      await tx.healthAlert.update({ where: { id: before.id }, data: { category: data.category, severity: data.severity, textEnc, updatedById: v.userId } });
      await recordAudit(auditCtx(v, meta), { action: "UPDATE", entityType: "HealthAlert", entityId: before.id, before: { category: before.category, severity: before.severity }, after: { category: data.category, severity: data.severity, studentId } }, tx);
    } else {
      const count = await tx.healthAlert.count({ where: { tenantId: v.tenantId, studentId } });
      if (count >= MAX_ALERTS_PER_PUPIL) throw new HealthError("tooManyAlerts");
      const row = await tx.healthAlert.create({ data: { tenantId: v.tenantId, studentId, category: data.category, severity: data.severity, textEnc, updatedById: v.userId } });
      await recordAudit(auditCtx(v, meta), { action: "CREATE", entityType: "HealthAlert", entityId: row.id, after: { category: data.category, severity: data.severity, studentId } }, tx);
    }
  });
}

/** The nurse removes an alert. */
export async function deleteAlert(v: HealthViewer, alertId: string, meta: Meta) {
  if (!canManageAlerts(v)) throw new HealthError("notAllowed");
  await platformPrisma().$transaction(async (tx) => {
    const row = await tx.healthAlert.findFirst({ where: { id: alertId, tenantId: v.tenantId }, select: { id: true, studentId: true, category: true, severity: true } });
    if (!row) throw new HealthError("notFound");
    await tx.healthAlert.delete({ where: { id: row.id } });
    await recordAudit(auditCtx(v, meta), { action: "DELETE", entityType: "HealthAlert", entityId: row.id, before: { category: row.category, severity: row.severity, studentId: row.studentId } }, tx);
  });
}

/** Dashboard numbers: pupils with alerts (and how many severe) in this person's view. */
export async function alertCounts(v: HealthViewer): Promise<{ pupils: number; severe: number }> {
  const board = await alertsBoard(v);
  const pupils = board.flatMap((s) => s.pupils);
  return { pupils: pupils.length, severe: pupils.filter((p) => p.alerts.some((a) => a.severity === "SEVERE")).length };
}
