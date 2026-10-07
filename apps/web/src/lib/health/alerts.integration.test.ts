import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import { alertsBoard, alertsFor, deleteAlert, MAX_ALERTS_PER_PUPIL, pupilAlerts, saveAlert } from "./alerts";
import { emergencyCards } from "./card";
import { HealthError, healthViewer, saveContacts, saveProfile, withdrawConsent, type HealthViewer } from "./data";

/**
 * Health alerts and emergency cards (Phase 7.1) against a real Postgres
 * (migrations through 0030): only the nurse writes alerts; teachers see
 * alerts only for sections they teach; parents only their own child;
 * other schools nothing; the app's database role is locked out; cards show
 * the right level of detail and every card is logged.
 */

process.env.HEALTH_DATA_KEY ??= "test-health-key-0123456789";
process.env.NEXTAUTH_SECRET ??= "test-secret";

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
let A: string;
let B: string;
const ids: Record<string, string> = {};
const v: Record<string, HealthViewer> = {};
const PEANUTS = { category: "ALLERGY", severity: "SEVERE", text: "Severe peanut allergy - EpiPen in bag; call nurse and parent" };

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "SCHOOL_NURSE" | "TEACHER" | "PARENT" | "ACCOUNTANT") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@alerts.test`, name: key, role } })).id;
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Alerts A", slug: `al-a-${stamp}`, subdomain: `al-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Alerts B", slug: `al-b-${stamp}`, subdomain: `al-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "Y", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  const jss1 = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name: "JSS1" } });
  const [s1, s2] = await Promise.all([prisma.section.create({ data: { tenantId: A, classId: jss1.id, name: "A" } }), prisma.section.create({ data: { tenantId: A, classId: jss1.id, name: "B" } })]);
  ids.s1 = s1.id;
  ids.s2 = s2.id;
  await Promise.all([user(A, "admin", "SCHOOL_ADMIN"), user(A, "nurse", "SCHOOL_NURSE"), user(A, "teacher", "TEACHER"), user(A, "otherTeacher", "TEACHER"), user(A, "bursar", "ACCOUNTANT"), user(A, "p1", "PARENT"), user(B, "bNurse", "SCHOOL_NURSE")]);
  // "teacher" teaches maths in JSS1 A only; "otherTeacher" teaches nothing.
  const t = await prisma.teacher.create({ data: { tenantId: A, userId: ids.teacher!, employeeId: `T-${stamp}` } });
  await prisma.teacher.create({ data: { tenantId: A, userId: ids.otherTeacher!, employeeId: `T2-${stamp}` } });
  const maths = await prisma.subject.create({ data: { tenantId: A, name: "Maths", code: `M${stamp}` } });
  await prisma.classSectionSubject.create({ data: { tenantId: A, sectionId: s1.id, subjectId: maths.id, teacherId: t.id } });
  const mk = (n: string, sectionId: string) => prisma.student.create({ data: { tenantId: A, admissionNo: `AL-${stamp}-${n}`, firstName: n, lastName: "Pupil", academicYearId: year.id, classId: jss1.id, sectionId } });
  const [ada, bo] = await Promise.all([mk("Ada", s1.id), mk("Bo", s2.id)]);
  ids.ada = ada.id;
  ids.bo = bo.id;
  const g = await prisma.guardian.create({ data: { tenantId: A, userId: ids.p1! } });
  await prisma.studentGuardian.create({ data: { tenantId: A, studentId: ada.id, guardianId: g.id, relationship: "MOTHER" } });
  for (const [k, role] of [["admin", "SCHOOL_ADMIN"], ["nurse", "SCHOOL_NURSE"], ["teacher", "TEACHER"], ["otherTeacher", "TEACHER"], ["bursar", "ACCOUNTANT"], ["p1", "PARENT"]] as const) v[k] = await healthViewer(A, { id: ids[k]!, role });
  v.bNurse = await healthViewer(B, { id: ids.bNurse!, role: "SCHOOL_NURSE" });
  v.support = await healthViewer(A, { id: ids.admin!, role: "SCHOOL_ADMIN" }, { impersonating: true });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("writing alerts", () => {
  it("only the nurse writes alerts; everyone else is refused", async () => {
    for (const k of ["admin", "teacher", "p1", "bursar", "support"]) {
      await expect(saveAlert(v[k]!, ids.ada!, null, PEANUTS, meta)).rejects.toEqual(new HealthError("notAllowed"));
    }
    await expect(saveAlert(v.bNurse!, ids.ada!, null, PEANUTS, meta)).rejects.toEqual(new HealthError("notFound")); // another school's pupil
    await saveAlert(v.nurse!, ids.ada!, null, PEANUTS, meta);
    await saveAlert(v.nurse!, ids.bo!, null, { category: "ASTHMA", severity: "MODERATE", text: "Inhaler in blue pouch" }, meta);
  });

  it("the text is encrypted at rest; the audit log records type and severity only", async () => {
    const row = await prisma.healthAlert.findFirstOrThrow({ where: { studentId: ids.ada } });
    expect(row.textEnc).toMatch(/^v1\./);
    expect(row.textEnc).not.toContain("peanut");
    const logs = await prisma.auditLog.findMany({ where: { tenantId: A, entityType: "HealthAlert" } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(logs)).not.toMatch(/peanut|EpiPen|Inhaler/i);
  });

  it("rejects bad input and caps the number per pupil", async () => {
    await expect(saveAlert(v.nurse!, ids.ada!, null, { ...PEANUTS, text: "x" }, meta)).rejects.toThrow();
    await expect(saveAlert(v.nurse!, ids.ada!, null, { ...PEANUTS, category: "COLD" }, meta)).rejects.toThrow();
    // Bo has one alert; fill up to the cap.
    for (let i = 1; i < MAX_ALERTS_PER_PUPIL; i++) await saveAlert(v.nurse!, ids.bo!, null, { category: "OTHER", severity: "MILD", text: "Glasses for the board" }, meta);
    await expect(saveAlert(v.nurse!, ids.bo!, null, { category: "OTHER", severity: "MILD", text: "One too many" }, meta)).rejects.toEqual(new HealthError("tooManyAlerts"));
    // Tidy back to one alert for Bo.
    const rows = await prisma.healthAlert.findMany({ where: { studentId: ids.bo, category: "OTHER" } });
    for (const r of rows) await deleteAlert(v.nurse!, r.id, meta);
    expect(await prisma.healthAlert.count({ where: { studentId: ids.bo } })).toBe(1);
  });

  it("the nurse edits an alert; another school's nurse can't touch it", async () => {
    const row = await prisma.healthAlert.findFirstOrThrow({ where: { studentId: ids.bo } });
    await saveAlert(v.nurse!, ids.bo!, row.id, { category: "ASTHMA", severity: "SEVERE", text: "Inhaler in blue pouch; call nurse" }, meta);
    expect((await pupilAlerts(v.nurse!, ids.bo!))[0]).toMatchObject({ severity: "SEVERE", text: "Inhaler in blue pouch; call nurse" });
    await expect(deleteAlert(v.bNurse!, row.id, meta)).rejects.toEqual(new HealthError("notFound"));
  });
});

describe("who sees alerts", () => {
  it("teachers: only pupils in sections they teach; the nurse and admins: everyone; parents: their own child", async () => {
    const both = [ids.ada!, ids.bo!];
    expect(Object.keys(await alertsFor(v.teacher!, both))).toEqual([ids.ada]);
    expect(Object.keys(await alertsFor(v.otherTeacher!, both))).toEqual([]);
    expect(Object.keys(await alertsFor(v.nurse!, both)).sort()).toEqual([...both].sort());
    expect(Object.keys(await alertsFor(v.admin!, both)).sort()).toEqual([...both].sort());
    expect(Object.keys(await alertsFor(v.p1!, both))).toEqual([ids.ada]);
    expect((await alertsFor(v.teacher!, both))[ids.ada!]![0]!.text).toBe(PEANUTS.text);
  });

  it("bursars, support sign-ins and other schools see none", async () => {
    const both = [ids.ada!, ids.bo!];
    expect(await alertsFor(v.bursar!, both)).toEqual({});
    expect(await alertsFor(v.support!, both)).toEqual({});
    expect(await alertsFor(v.bNurse!, both)).toEqual({});
    await expect(pupilAlerts(v.teacher!, ids.bo!)).rejects.toEqual(new HealthError("notFound"));
    await expect(pupilAlerts(v.bNurse!, ids.ada!)).rejects.toEqual(new HealthError("notFound"));
  });

  it("the alerts page: teachers get their sections only; the nurse every section", async () => {
    const tBoard = await alertsBoard(v.teacher!);
    expect(tBoard.map((s) => s.sectionId)).toEqual([ids.s1]);
    expect(tBoard[0]!.pupils.map((p) => p.id)).toEqual([ids.ada]);
    const nBoard = await alertsBoard(v.nurse!);
    expect(nBoard.map((s) => s.sectionId).sort()).toEqual([ids.s1, ids.s2].sort());
    await expect(alertsBoard(v.p1!)).rejects.toEqual(new HealthError("notAllowed"));
    await expect(alertsBoard(v.support!)).rejects.toEqual(new HealthError("notAllowed"));
  });

  it("the app's database role can't read alerts, even inside the right school", async () => {
    await expect(withRls(A, (tx) => tx.healthAlert.findMany())).rejects.toThrow();
  });
});

describe("emergency cards", () => {
  beforeAll(async () => {
    await saveProfile(v.p1!, ids.ada!, { data: { bloodGroup: "O+", genotype: "AS", allergies: [{ name: "Peanuts", reaction: "Swelling", severity: "severe" }] }, consent: true }, meta);
    await saveContacts(v.p1!, ids.ada!, [{ name: "Mrs Pupil", relationship: "Mother", phone: "+234 803 000 0000" }], meta);
  });

  it("a teacher's class card: alerts and contacts, no medical details; logged", async () => {
    const before = await prisma.healthAccessLog.count({ where: { tenantId: A, actorId: ids.teacher } });
    const doc = await emergencyCards(v.teacher!, { sectionId: ids.s1! }, meta);
    expect(doc.title).toBe("JSS1 A");
    expect(doc.cards).toHaveLength(1);
    expect(doc.cards[0]).toMatchObject({ level: "basic", name: "Ada Pupil", full: null });
    expect(doc.cards[0]!.alerts[0]!.text).toBe(PEANUTS.text);
    expect(doc.cards[0]!.contacts[0]!.phone).toBe("+234 803 000 0000");
    expect(JSON.stringify(doc)).not.toMatch(/O\+|"AS"|Swelling/);
    const logs = await prisma.healthAccessLog.findMany({ where: { tenantId: A, actorId: ids.teacher } });
    expect(logs.length - before).toBe(1);
    expect(logs.at(-1)).toMatchObject({ action: "VIEW_CARD", studentId: ids.ada });
  });

  it("a teacher can't print a class they don't teach, or a pupil outside their classes", async () => {
    await expect(emergencyCards(v.teacher!, { sectionId: ids.s2! }, meta)).rejects.toEqual(new HealthError("notFound"));
    await expect(emergencyCards(v.teacher!, { studentId: ids.bo! }, meta)).rejects.toEqual(new HealthError("notFound"));
    await expect(emergencyCards(v.otherTeacher!, { sectionId: ids.s1! }, meta)).rejects.toEqual(new HealthError("notFound"));
  });

  it("the nurse and the parent get the full card; admins only basic unless the school allows full records", async () => {
    const nurse = await emergencyCards(v.nurse!, { studentId: ids.ada! }, meta);
    expect(nurse.cards[0]).toMatchObject({ level: "full", full: { bloodGroup: "O+", genotype: "AS" } });
    const parent = await emergencyCards(v.p1!, { studentId: ids.ada! }, meta);
    expect(parent.cards[0]!.level).toBe("full");
    await expect(emergencyCards(v.p1!, { studentId: ids.bo! }, meta)).rejects.toEqual(new HealthError("notFound"));
    await expect(emergencyCards(v.p1!, { sectionId: ids.s1! }, meta)).rejects.toEqual(new HealthError("notFound"));
    const admin = await emergencyCards(v.admin!, { sectionId: ids.s1! }, meta);
    expect(admin.cards[0]!.level).toBe("basic");
    const fullAdmin = { ...v.admin!, adminFullAccess: true };
    expect((await emergencyCards(fullAdmin, { studentId: ids.ada! }, meta)).cards[0]!.level).toBe("full");
    expect((await prisma.healthAccessLog.findFirst({ where: { tenantId: A, actorId: ids.nurse, action: "VIEW_CARD_FULL" } }))?.studentId).toBe(ids.ada);
  });

  it("other schools, bursars and support sign-ins get nothing", async () => {
    await expect(emergencyCards(v.bNurse!, { studentId: ids.ada! }, meta)).rejects.toEqual(new HealthError("notFound"));
    await expect(emergencyCards(v.bNurse!, { sectionId: ids.s1! }, meta)).rejects.toEqual(new HealthError("notFound"));
    await expect(emergencyCards(v.bursar!, { sectionId: ids.s1! }, meta)).rejects.toEqual(new HealthError("notFound"));
    await expect(emergencyCards(v.support!, { sectionId: ids.s1! }, meta)).rejects.toEqual(new HealthError("notFound"));
  });

  it("withdrawing consent removes the pupil's alerts too", async () => {
    await withdrawConsent(v.p1!, ids.ada!, meta);
    expect(await prisma.healthAlert.count({ where: { studentId: ids.ada } })).toBe(0);
    expect(await prisma.healthAlert.count({ where: { studentId: ids.bo } })).toBe(1);
  });
});
