import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import { saveAlert } from "./alerts";
import { HealthError, healthViewer, saveContacts, saveProfile, type HealthViewer } from "./data";
import { listVisits, runHealthRetention, saveVisit, visitForEdit, VisitError, visitRecipients, visitReport } from "./visits";

/**
 * The clinic visit log (Phase 7.2) against a real Postgres (migrations
 * through 0031): only the nurse records; medicine only if the parent
 * permitted it; parents see their own child's visits in full; teachers only
 * when and the outcome, for their own classes; reports are counts; other
 * schools see nothing; the app's database role is locked out; pupils who
 * left are cleaned up after the retention period with counts kept.
 */

process.env.HEALTH_DATA_KEY ??= "test-health-key-0123456789";
process.env.NEXTAUTH_SECRET ??= "test-secret";

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
let A: string;
let B: string;
const ids: Record<string, string> = {};
const v: Record<string, HealthViewer> = {};
const base = { arrivedAt: "2026-10-05T09:00", leftAt: "2026-10-05T09:40", complaint: "HEADACHE", complaintNote: "Since breakfast", temperature: 37.9, careGiven: "Rested, water" };

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "SCHOOL_NURSE" | "TEACHER" | "PARENT" | "ACCOUNTANT") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@visits.test`, name: key, role } })).id;
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Visits A", slug: `vi-a-${stamp}`, subdomain: `vi-a-${stamp}`, settings: { timezone: "Africa/Lagos" } } }),
    prisma.tenant.create({ data: { name: "Visits B", slug: `vi-b-${stamp}`, subdomain: `vi-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "Y", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  const jss1 = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name: "JSS1" } });
  const [s1, s2] = await Promise.all([prisma.section.create({ data: { tenantId: A, classId: jss1.id, name: "A" } }), prisma.section.create({ data: { tenantId: A, classId: jss1.id, name: "B" } })]);
  await Promise.all([user(A, "admin", "SCHOOL_ADMIN"), user(A, "nurse", "SCHOOL_NURSE"), user(A, "teacher", "TEACHER"), user(A, "bursar", "ACCOUNTANT"), user(A, "p1", "PARENT"), user(B, "bNurse", "SCHOOL_NURSE")]);
  const t = await prisma.teacher.create({ data: { tenantId: A, userId: ids.teacher!, employeeId: `VT-${stamp}` } });
  const maths = await prisma.subject.create({ data: { tenantId: A, name: "Maths", code: `VM${stamp}` } });
  await prisma.classSectionSubject.create({ data: { tenantId: A, sectionId: s1.id, subjectId: maths.id, teacherId: t.id } });
  const mk = (n: string, sectionId: string) => prisma.student.create({ data: { tenantId: A, admissionNo: `VI-${stamp}-${n}`, firstName: n, lastName: "Pupil", academicYearId: year.id, classId: jss1.id, sectionId } });
  const [ada, bo, cy] = await Promise.all([mk("Ada", s1.id), mk("Bo", s2.id), mk("Cy", s2.id)]);
  ids.ada = ada.id;
  ids.bo = bo.id;
  ids.cy = cy.id;
  const g = await prisma.guardian.create({ data: { tenantId: A, userId: ids.p1! } });
  await prisma.studentGuardian.create({ data: { tenantId: A, studentId: ada.id, guardianId: g.id, relationship: "MOTHER" } });
  for (const [k, role] of [["admin", "SCHOOL_ADMIN"], ["nurse", "SCHOOL_NURSE"], ["teacher", "TEACHER"], ["bursar", "ACCOUNTANT"], ["p1", "PARENT"]] as const) v[k] = await healthViewer(A, { id: ids[k]!, role });
  v.bNurse = await healthViewer(B, { id: ids.bNurse!, role: "SCHOOL_NURSE" });
  v.support = await healthViewer(A, { id: ids.admin!, role: "SCHOOL_ADMIN" }, { impersonating: true });
  // Ada's parent permits paracetamol; her inhaler is taken at school.
  await saveProfile(v.p1!, ids.ada!, { data: { permittedMedicines: ["paracetamol"], medications: [{ name: "Salbutamol inhaler", dose: "2 puffs", schedule: "as needed", atSchool: true }] }, consent: true }, meta);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("recording visits", () => {
  it("only the nurse records visits", async () => {
    for (const k of ["admin", "teacher", "p1", "bursar", "support"]) await expect(saveVisit(v[k]!, { studentId: ids.ada! }, base, meta)).rejects.toEqual(new HealthError("notAllowed"));
    await expect(saveVisit(v.bNurse!, { studentId: ids.ada! }, base, meta)).rejects.toEqual(new HealthError("notFound"));
  });

  it("medicine only if the parent permitted it (or the pupil's own medicine taken at school)", async () => {
    const give = (code: string, name = "") => ({ ...base, medicines: [{ code, name, dose: "1", time: "09:10" }] });
    await expect(saveVisit(v.nurse!, { studentId: ids.ada! }, give("ibuprofen"), meta)).rejects.toBeInstanceOf(VisitError);
    await expect(saveVisit(v.nurse!, { studentId: ids.ada! }, give("own", "Ventolin"), meta)).rejects.toBeInstanceOf(VisitError);
    await expect(saveVisit(v.nurse!, { studentId: ids.bo! }, give("paracetamol"), meta)).rejects.toBeInstanceOf(VisitError); // no profile, nothing permitted
    const r = await saveVisit(v.nurse!, { studentId: ids.ada! }, { ...base, medicines: [{ code: "paracetamol", name: "", dose: "500 mg", time: "09:10" }, { code: "own", name: "salbutamol inhaler", dose: "2 puffs", time: "09:15" }], outcome: "BACK_TO_CLASS" }, meta);
    expect(r.notify).toBe(true);
    ids.v1 = r.id;
  });

  it("rejects impossible times", async () => {
    await expect(saveVisit(v.nurse!, { studentId: ids.ada! }, { ...base, leftAt: "2026-10-05T08:00" }, meta)).rejects.toThrow();
    await expect(saveVisit(v.nurse!, { studentId: ids.ada! }, { ...base, arrivedAt: "2099-01-01T09:00", leftAt: "" }, meta)).rejects.toEqual(new HealthError("notFound"));
  });

  it("report fields are plain, clinical details encrypted; the audit log names no complaint", async () => {
    const row = await prisma.clinicVisit.findUniqueOrThrow({ where: { id: ids.v1 } });
    expect(row).toMatchObject({ complaint: "HEADACHE", outcome: "BACK_TO_CLASS", classLabel: "JSS1 A", medicines: ["paracetamol", "own"] });
    expect(row.detailEnc).toMatch(/^v1\./);
    expect(row.detailEnc).not.toMatch(/breakfast|Rested|500 mg/);
    const logs = await prisma.auditLog.findMany({ where: { tenantId: A, entityType: "ClinicVisit" } });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toMatch(/HEADACHE|breakfast|paracetamol/i);
  });

  it("parents are told about a new visit, a first outcome and an urgent change — not every edit", async () => {
    const open = await saveVisit(v.nurse!, { studentId: ids.bo! }, { ...base, leftAt: "", complaint: "INJURY" }, meta);
    expect(open.notify).toBe(true);
    const values = (await visitForEdit(v.nurse!, open.id)).values;
    expect((await saveVisit(v.nurse!, { studentId: ids.bo!, visitId: open.id }, { ...values, outcome: "RESTED", leftAt: "2026-10-05T09:30" }, meta)).notify).toBe(true);
    expect((await saveVisit(v.nurse!, { studentId: ids.bo!, visitId: open.id }, { ...values, outcome: "RESTED", leftAt: "2026-10-05T09:35", careGiven: "Ice pack" }, meta)).notify).toBe(false);
    expect((await saveVisit(v.nurse!, { studentId: ids.bo!, visitId: open.id }, { ...values, outcome: "SENT_HOME", leftAt: "2026-10-05T09:35" }, meta)).notify).toBe(true);
    await expect(saveVisit(v.nurse!, { studentId: ids.ada!, visitId: open.id }, base, meta)).rejects.toEqual(new HealthError("notFound")); // visit belongs to Bo
    const r = await visitRecipients(A, ids.v1!);
    expect(r).toMatchObject({ pupil: "Ada Pupil", urgent: false, to: [{ id: ids.p1 }] });
    expect(await visitRecipients(B, ids.v1!)).toBeNull();
  });
});

describe("who sees visits", () => {
  it("the nurse and the parent see the full visit; the parent only their own child", async () => {
    const nurse = await listVisits(v.nurse!);
    expect(nurse.map((x) => x.view)).toEqual(["full", "full"]);
    const parent = await listVisits(v.p1!);
    expect(parent.map((x) => x.studentId)).toEqual([ids.ada]);
    expect(parent[0]).toMatchObject({ view: "full", complaint: "HEADACHE" });
    expect(parent[0]!.detail?.complaintNote).toBe("Since breakfast");
    expect(await listVisits(v.p1!, { studentId: ids.bo! })).toEqual([]);
  });

  it("teachers: only when and the outcome, only for their classes; admins: summary unless the school allows full records", async () => {
    const teacher = await listVisits(v.teacher!);
    expect(teacher.map((x) => x.studentId)).toEqual([ids.ada]);
    expect(teacher[0]).toMatchObject({ view: "summary", complaint: null, detail: null, outcome: "BACK_TO_CLASS" });
    const admin = await listVisits(v.admin!);
    expect(admin.every((x) => x.view === "summary" && x.detail === null)).toBe(true);
    expect((await listVisits({ ...v.admin!, adminFullAccess: true })).every((x) => x.view === "full")).toBe(true);
  });

  it("bursars, support sign-ins and other schools see nothing; the app's database role is locked out", async () => {
    expect(await listVisits(v.bursar!)).toEqual([]);
    expect(await listVisits(v.support!)).toEqual([]);
    expect(await listVisits(v.bNurse!)).toEqual([]);
    await expect(withRls(A, (tx) => tx.clinicVisit.findMany())).rejects.toThrow();
  });

  it("reports are counts only, for the nurse and admins", async () => {
    const r = await visitReport(v.nurse!, { from: "2026-10-01", to: "2026-10-07" });
    expect(r.total).toBe(2);
    expect(r.byComplaint).toEqual([{ key: "HEADACHE", count: 1 }, { key: "INJURY", count: 1 }]);
    expect(r.byOutcome.find((x) => x.key === "SENT_HOME")?.count).toBe(1);
    expect(r.byMedicine.map((x) => x.key).sort()).toEqual(["own", "paracetamol"]);
    expect(r.byDay).toEqual([{ day: "2026-10-05", count: 2 }]);
    expect(JSON.stringify(r)).not.toMatch(/Ada|Bo Pupil/);
    expect((await visitReport(v.admin!, { from: "2026-10-01", to: "2026-10-07" })).total).toBe(2);
    await expect(visitReport(v.teacher!, { from: "2026-10-01", to: "2026-10-07" })).rejects.toEqual(new HealthError("notAllowed"));
    await expect(visitReport(v.p1!, { from: "2026-10-01", to: "2026-10-07" })).rejects.toEqual(new HealthError("notAllowed"));
    expect((await visitReport(v.bNurse!, { from: "2026-10-01", to: "2026-10-07" })).total).toBe(0);
  });
});

describe("leaving and retention", () => {
  it("the leaving date is kept by the database whichever way the status changes", async () => {
    await prisma.student.update({ where: { id: ids.cy }, data: { status: "WITHDRAWN" } });
    const left = (await prisma.student.findUniqueOrThrow({ where: { id: ids.cy } })).leftAt;
    expect(left).toBeInstanceOf(Date);
    await prisma.student.update({ where: { id: ids.cy }, data: { status: "GRADUATED" } });
    expect((await prisma.student.findUniqueOrThrow({ where: { id: ids.cy } })).leftAt).toEqual(left);
    await prisma.student.update({ where: { id: ids.cy }, data: { status: "ACTIVE" } });
    expect((await prisma.student.findUniqueOrThrow({ where: { id: ids.cy } })).leftAt).toBeNull();
  });

  it("after the retention period a pupil's health data goes and their visits become anonymous counts; recent leavers are kept", async () => {
    // Bo left two years ago (retention is 1 year); Cy left last week.
    await saveAlert(v.nurse!, ids.bo!, null, { category: "ASTHMA", severity: "MODERATE", text: "Inhaler in bag" }, meta);
    await saveContacts(v.nurse!, ids.bo!, [{ name: "Mr Pupil", phone: "+234 803 111 1111" }], meta);
    await prisma.student.update({ where: { id: ids.bo }, data: { status: "WITHDRAWN" } });
    await prisma.student.update({ where: { id: ids.bo }, data: { leftAt: new Date(Date.now() - 2 * 365 * 86_400_000) } });
    await prisma.student.update({ where: { id: ids.cy }, data: { status: "WITHDRAWN" } });
    await prisma.student.update({ where: { id: ids.cy }, data: { leftAt: new Date(Date.now() - 7 * 86_400_000) } });
    await saveAlert(v.nurse!, ids.cy!, null, { category: "OTHER", severity: "MILD", text: "Glasses" }, meta).catch(() => undefined); // Cy is no longer active: may be refused
    const out = await runHealthRetention();
    expect(out.done.find((d) => d.tenantId === A)?.pupils).toBe(1);
    expect(await prisma.healthAlert.count({ where: { studentId: ids.bo } })).toBe(0);
    expect(await prisma.emergencyContact.count({ where: { studentId: ids.bo } })).toBe(0);
    expect(await prisma.clinicVisit.count({ where: { studentId: ids.bo } })).toBe(0);
    expect(await prisma.clinicVisit.count({ where: { tenantId: A, studentId: null, detailEnc: null } })).toBe(1);
    expect((await visitReport(v.nurse!, { from: "2026-10-01", to: "2026-10-07" })).total).toBe(2); // counts kept
    expect(await prisma.healthProfile.count({ where: { studentId: ids.ada } })).toBe(1); // active pupils untouched
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: A, entityType: "HealthRetention" } });
    expect(audit?.actorId).toBeNull();
    // Nothing more to do the next night.
    expect((await runHealthRetention()).done.find((d) => d.tenantId === A)).toBeUndefined();
  });
});
