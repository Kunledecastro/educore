import { platformPrisma, withRls } from "@educore/db";
import { decryptSecret } from "../security/secrets";
import { parseTenantSettings } from "../tenant-settings";
import { loadDocBranding, type DocBranding } from "../branding-data";
import { healthProfileSchema } from "./profile";
import { HealthError, healthKey, type HealthViewer, type Meta } from "./data";
import { cardLevel, canSeeAlerts, sortAlerts, type AlertCategory, type AlertSeverity, type CardLevel } from "./rules";

/**
 * The emergency card (Phase 7.1): one per pupil, or a whole class for a
 * trip. "Basic" cards (teachers) carry alerts and emergency contacts; "full"
 * cards (the nurse; parents for their own child; admins if the school
 * allows) add blood group, genotype, allergies and regular medicines. Every
 * card produced is written to the health access log.
 */

export interface EmergencyCard {
  level: Exclude<CardLevel, null>;
  name: string;
  admissionNo: string;
  className: string | null;
  alerts: { category: AlertCategory; severity: AlertSeverity; text: string }[];
  contacts: { name: string; relationship: string; phone: string; altPhone: string | null }[];
  full: null | {
    bloodGroup: string;
    genotype: string;
    allergies: { name: string; reaction: string; severity: string }[];
    medications: { name: string; dose: string; schedule: string; atSchool: boolean }[];
    permittedMedicines: string[];
  };
}

export interface EmergencyCardsDoc {
  school: { name: string; locale: string; branding: DocBranding | null };
  title: string; // class label or pupil name
  generatedAt: Date;
  timezone: string;
  cards: EmergencyCard[];
}

export async function emergencyCards(v: HealthViewer, target: { studentId: string } | { sectionId: string }, meta: Meta): Promise<EmergencyCardsDoc> {
  if (v.impersonating) throw new HealthError("notFound");
  const key = healthKey();
  let sectionLabel = "";
  const pupils = await withRls(v.tenantId, async (tx) => {
    if ("sectionId" in target) {
      const section = await tx.section.findFirst({ where: { id: target.sectionId, tenantId: v.tenantId }, select: { name: true, class: { select: { name: true } } } });
      if (!section) return null;
      sectionLabel = `${section.class.name} ${section.name}`;
    }
    return tx.student.findMany({
      where: { tenantId: v.tenantId, ...("studentId" in target ? { id: target.studentId } : { sectionId: target.sectionId, status: "ACTIVE" }) },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, admissionNo: true, sectionId: true, section: { select: { name: true, class: { select: { name: true } } } } },
    });
  });
  if (!pupils) throw new HealthError("notFound");
  // A class card needs the right to see that class (teacher of it, the nurse, admins).
  if ("sectionId" in target && !canSeeAlerts(v, { id: "__class__", sectionId: target.sectionId })) throw new HealthError("notFound");
  const levels = new Map(pupils.map((p) => [p.id, cardLevel(v, p)]));
  const visible = pupils.filter((p) => levels.get(p.id));
  if ("studentId" in target && visible.length === 0) throw new HealthError("notFound");
  const ids = visible.map((p) => p.id);
  const fullIds = visible.filter((p) => levels.get(p.id) === "full").map((p) => p.id);

  const db = platformPrisma();
  const [alerts, profiles] = await db.$transaction(async (tx) => {
    if (ids.length) {
      await tx.healthAccessLog.createMany({
        data: ids.map((studentId) => ({ tenantId: v.tenantId, actorId: v.userId, actorRole: v.role, studentId, action: levels.get(studentId) === "full" ? "VIEW_CARD_FULL" : "VIEW_CARD", ipAddress: meta.ipAddress })),
      });
    }
    return Promise.all([
      tx.healthAlert.findMany({ where: { tenantId: v.tenantId, studentId: { in: ids } } }),
      fullIds.length ? tx.healthProfile.findMany({ where: { tenantId: v.tenantId, studentId: { in: fullIds } }, select: { studentId: true, dataEnc: true } }) : Promise.resolve([]),
    ]);
  });
  const contacts = ids.length ? await withRls(v.tenantId, (tx) => tx.emergencyContact.findMany({ where: { tenantId: v.tenantId, studentId: { in: ids } }, orderBy: { priority: "asc" } })) : [];
  const [school, branding] = await Promise.all([db.tenant.findUnique({ where: { id: v.tenantId }, select: { name: true, settings: true } }), loadDocBranding(v.tenantId)]);
  const settings = parseTenantSettings(school?.settings);

  const cards: EmergencyCard[] = visible.map((p) => {
    const level = levels.get(p.id)!;
    const prof = profiles.find((x) => x.studentId === p.id);
    const data = level === "full" && prof ? healthProfileSchema.parse(JSON.parse(decryptSecret(prof.dataEnc, key))) : null;
    return {
      level,
      name: `${p.firstName} ${p.lastName}`,
      admissionNo: p.admissionNo,
      className: p.section ? `${p.section.class.name} ${p.section.name}` : null,
      alerts: sortAlerts(alerts.filter((a) => a.studentId === p.id).map((a) => ({ category: a.category as AlertCategory, severity: a.severity as AlertSeverity, text: decryptSecret(a.textEnc, key) }))),
      contacts: contacts.filter((c) => c.studentId === p.id).map((c) => ({ name: c.name, relationship: c.relationship, phone: c.phone, altPhone: c.altPhone })),
      full:
        level === "full"
          ? {
              bloodGroup: data?.bloodGroup ?? "unknown",
              genotype: data?.genotype ?? "unknown",
              allergies: data?.allergies ?? [],
              medications: data?.medications ?? [],
              permittedMedicines: data?.permittedMedicines ?? [],
            }
          : null,
    };
  });
  const title = "studentId" in target ? cards[0]?.name ?? "" : sectionLabel;
  return { school: { name: school?.name ?? "", locale: settings.locale, branding }, title, generatedAt: new Date(), timezone: settings.timezone, cards };
}
