import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import type { ObjectStore } from "../storage/object-store";
import {
  accessLog,
  attachDocument,
  clinicList,
  documentLink,
  familyHealthList,
  HealthError,
  healthViewer,
  openRecord,
  requestDocumentUpload,
  saveContacts,
  saveHealthSettings,
  saveProfile,
  verifyProfile,
  withdrawConsent,
  type HealthViewer,
} from "./data";

/**
 * Student health against a real Postgres (migrations through 0029): school
 * isolation, parents only their own child, the nurse everyone, admins only
 * with the school's setting (and never while impersonated), consent before
 * saving, encryption at rest, every read logged, the app's database role
 * locked out, documents, withdrawal.
 */

process.env.HEALTH_DATA_KEY ??= "test-health-key-0123456789";
process.env.NEXTAUTH_SECRET ??= "test-secret";

class MemoryStore implements ObjectStore {
  objects = new Map<string, Uint8Array>();
  removed: string[] = [];
  configured() {
    return true;
  }
  async createUploadUrl(key: string) {
    return `memory://upload/${key}`;
  }
  async inspect(key: string) {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.length, head: o.slice(0, 16) } : null;
  }
  async createDownloadUrl(key: string) {
    return `memory://download/${key}`;
  }
  async remove(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
    this.removed.push(...keys);
  }
}
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 1, 2, 3, 4, 5, 6, 7, 8]);

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
const store = new MemoryStore();
let A: string;
let B: string;
const ids: Record<string, string> = {};
const v: Record<string, HealthViewer> = {};
const PROFILE = { genotype: "AS", bloodGroup: "O+", allergies: [{ name: "Peanuts", reaction: "Swelling", severity: "severe" }], medications: [{ name: "Salbutamol inhaler", dose: "2 puffs", schedule: "as needed", atSchool: true }] };

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "SCHOOL_NURSE" | "TEACHER" | "PARENT" | "ACCOUNTANT") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@health.test`, name: key, role } })).id;
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Health A", slug: `hl-a-${stamp}`, subdomain: `hl-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Health B", slug: `hl-b-${stamp}`, subdomain: `hl-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "Y", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  const jss1 = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name: "JSS1" } });
  const s1 = await prisma.section.create({ data: { tenantId: A, classId: jss1.id, name: "A" } });
  await Promise.all([user(A, "admin", "SCHOOL_ADMIN"), user(A, "nurse", "SCHOOL_NURSE"), user(A, "teacher", "TEACHER"), user(A, "bursar", "ACCOUNTANT"), user(A, "p1", "PARENT"), user(A, "p2", "PARENT"), user(B, "bNurse", "SCHOOL_NURSE")]);
  const mk = (n: string) => prisma.student.create({ data: { tenantId: A, admissionNo: `HL-${stamp}-${n}`, firstName: n, lastName: "Pupil", academicYearId: year.id, classId: jss1.id, sectionId: s1.id } });
  const [ada, chi] = await Promise.all([mk("Ada"), mk("Chi")]);
  ids.ada = ada.id;
  ids.chi = chi.id;
  for (const [p, s] of [["p1", ada.id], ["p2", chi.id]] as const) {
    const g = await prisma.guardian.create({ data: { tenantId: A, userId: ids[p]! } });
    await prisma.studentGuardian.create({ data: { tenantId: A, studentId: s, guardianId: g.id, relationship: "MOTHER" } });
  }
  for (const [k, role] of [["admin", "SCHOOL_ADMIN"], ["nurse", "SCHOOL_NURSE"], ["teacher", "TEACHER"], ["bursar", "ACCOUNTANT"], ["p1", "PARENT"], ["p2", "PARENT"]] as const) v[k] = await healthViewer(A, { id: ids[k]!, role });
  v.bNurse = await healthViewer(B, { id: ids.bNurse!, role: "SCHOOL_NURSE" });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("parents fill in, with consent", () => {
  it("no consent, no profile; an empty form isn't stored", async () => {
    await expect(saveProfile(v.p1!, ids.ada!, { data: PROFILE, consent: false }, meta)).rejects.toEqual(new HealthError("consentRequired"));
    await expect(saveProfile(v.p1!, ids.ada!, { data: {}, consent: true }, meta)).rejects.toEqual(new HealthError("empty"));
  });

  it("a parent saves their own child's profile (encrypted at rest, consent recorded); never another child's", async () => {
    expect(await saveProfile(v.p1!, ids.ada!, { data: PROFILE, consent: true, verify: true }, meta)).toBe("SUBMITTED"); // parents can't verify
    const row = await prisma.healthProfile.findFirstOrThrow({ where: { studentId: ids.ada } });
    expect(row.dataEnc).toMatch(/^v1\./);
    expect(row.dataEnc).not.toContain("Peanuts");
    expect(row).toMatchObject({ consentSource: "ONLINE", consentById: ids.p1, status: "SUBMITTED" });
    await expect(saveProfile(v.p1!, ids.chi!, { data: PROFILE, consent: true }, meta)).rejects.toEqual(new HealthError("notFound"));
    expect((await familyHealthList(v.p1!)).map((c) => [c.name, c.status])).toEqual([["Ada Pupil", "SUBMITTED"]]);
  });

  it("the school audit log records the change, never the health details", async () => {
    const logs = await prisma.auditLog.findMany({ where: { tenantId: A, entityType: "HealthProfile" } });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toMatch(/Peanuts|Salbutamol|AS|O\+/);
  });
});

describe("the nurse checks; changes are flagged", () => {
  it("the nurse sees everyone's status, opens and verifies; a parent's later change needs re-checking", async () => {
    const list = await clinicList(v.nurse!);
    expect(list.summary).toMatchObject({ pupils: 2, SUBMITTED: 1, none: 1 });
    const rec = await openRecord(v.nurse!, ids.ada!, meta);
    expect(rec.profile!.data.allergies[0]).toMatchObject({ name: "Peanuts", severity: "severe" });
    expect(rec.canVerify).toBe(true);
    await verifyProfile(v.nurse!, ids.ada!, meta);
    await saveProfile(v.p1!, ids.ada!, { data: { ...PROFILE, genotype: "SS" }, consent: true }, meta);
    expect((await clinicList(v.nurse!, { status: "CHANGED" })).rows.map((r) => r.id)).toEqual([ids.ada]);
    await saveProfile(v.nurse!, ids.ada!, { data: { ...PROFILE, genotype: "SS" }, consent: false, verify: true }, meta);
    expect((await prisma.healthProfile.findFirstOrThrow({ where: { studentId: ids.ada } })).status).toBe("VERIFIED");
  });

  it("the nurse needs a signed paper form to start a record herself", async () => {
    await expect(saveProfile(v.nurse!, ids.chi!, { data: PROFILE, consent: false }, meta)).rejects.toEqual(new HealthError("consentRequired"));
    await saveProfile(v.nurse!, ids.chi!, { data: PROFILE, consent: true }, meta);
    expect(await prisma.healthProfile.findFirstOrThrow({ where: { studentId: ids.chi } })).toMatchObject({ consentSource: "PAPER", consentById: ids.nurse });
  });
});

describe("minimum necessary access", () => {
  it("admins see the list but open records only when the school allows it — and never while support works as them", async () => {
    expect((await clinicList(v.admin!)).summary.pupils).toBe(2);
    await expect(openRecord(v.admin!, ids.ada!, meta)).rejects.toEqual(new HealthError("notFound"));
    await saveHealthSettings(v.admin!, { adminFullAccess: true, retentionYears: 1 }, meta);
    const admin = await healthViewer(A, { id: ids.admin!, role: "SCHOOL_ADMIN" });
    expect((await openRecord(admin, ids.ada!, meta)).canEdit).toBe(false);
    const support = await healthViewer(A, { id: ids.admin!, role: "SCHOOL_ADMIN" }, { impersonating: true });
    await expect(openRecord(support, ids.ada!, meta)).rejects.toEqual(new HealthError("notFound"));
    await saveHealthSettings(v.admin!, { adminFullAccess: false, retentionYears: 1 }, meta);
  });

  it("teachers, bursars and other parents get nothing; another school's nurse can't reach these pupils", async () => {
    for (const k of ["teacher", "bursar", "p2"]) await expect(openRecord(v[k]!, ids.ada!, meta)).rejects.toEqual(new HealthError("notFound"));
    await expect(clinicList(v.teacher!)).rejects.toEqual(new HealthError("notAllowed"));
    await expect(openRecord(v.bNurse!, ids.ada!, meta)).rejects.toEqual(new HealthError("notFound"));
    await expect(saveProfile(v.bNurse!, ids.ada!, { data: PROFILE, consent: true }, meta)).rejects.toEqual(new HealthError("notFound"));
    expect((await clinicList(v.bNurse!)).summary.pupils).toBe(0);
  });

  it("every opening is logged; only admins can read the log, which never holds health details", async () => {
    const opened = await prisma.healthAccessLog.count({ where: { tenantId: A, studentId: ids.ada, action: "VIEW_RECORD" } });
    expect(opened).toBe(2); // nurse once, admin once (with the setting); refused attempts aren't openings
    const log = await accessLog(v.admin!);
    expect(log.rows[0]).toMatchObject({ pupil: "Ada Pupil", action: "VIEW_RECORD" });
    await expect(accessLog(v.nurse!)).rejects.toEqual(new HealthError("notAllowed"));
    expect(JSON.stringify(log)).not.toMatch(/Peanuts|Salbutamol/);
  });

  it("the app's database role can't read any health table, even inside the right school", async () => {
    await expect(withRls(A, (tx) => tx.healthProfile.findMany())).rejects.toThrow();
    await expect(withRls(A, (tx) => tx.healthDocument.findMany())).rejects.toThrow();
    await expect(withRls(A, (tx) => tx.healthAccessLog.findMany())).rejects.toThrow();
  });
});

describe("emergency contacts, documents, withdrawal", () => {
  it("contacts are kept per school (RLS) and need no consent", async () => {
    await saveContacts(v.p2!, ids.chi!, [{ name: "Mrs Okafor", relationship: "Mother", phone: "+234 803 000 0000" }], meta);
    await expect(saveContacts(v.p2!, ids.ada!, [{ name: "x", phone: "08030000000" }], meta)).rejects.toEqual(new HealthError("notFound"));
    expect(await withRls(B, (tx) => tx.emergencyContact.count({ where: { studentId: ids.chi } }))).toBe(0);
    expect(await withRls(A, (tx) => tx.emergencyContact.count({ where: { studentId: ids.chi } }))).toBe(1);
  });

  it("documents: type checked, opening logged, a parent can't reach another child's", async () => {
    const slot = await requestDocumentUpload(v.p1!, ids.ada!, { fileName: "letter.pdf", contentType: "application/pdf", sizeBytes: PDF.length }, store);
    const key = slot.uploadUrl.replace("memory://upload/", "");
    expect(key.startsWith(`${A}/health/${ids.ada}/`)).toBe(true);
    store.objects.set(key, PDF);
    await expect(attachDocument(v.p2!, ids.ada!, slot.grant, meta, store)).rejects.toEqual(new HealthError("notFound"));
    await attachDocument(v.p1!, ids.ada!, slot.grant, meta, store);
    const doc = await prisma.healthDocument.findFirstOrThrow({ where: { studentId: ids.ada } });
    expect(await withRls(A, (tx) => tx.pendingUpload.count({ where: { storageKey: key } }))).toBe(0);
    expect(await documentLink(v.nurse!, doc.id, meta, store)).toContain(key);
    await expect(documentLink(v.p2!, doc.id, meta, store)).rejects.toEqual(new HealthError("notFound"));
    await expect(documentLink(v.teacher!, doc.id, meta, store)).rejects.toEqual(new HealthError("notFound"));
    expect(await prisma.healthAccessLog.count({ where: { studentId: ids.ada, action: "VIEW_DOCUMENT" } })).toBe(1);
    await expect(requestDocumentUpload(v.p1!, ids.ada!, { fileName: "x.docx", contentType: "application/msword", sizeBytes: 10 }, store)).rejects.toEqual(new HealthError("badFile"));
  });

  it("withdrawing consent deletes the profile and documents but keeps emergency contacts", async () => {
    await saveContacts(v.p1!, ids.ada!, [{ name: "Mr Ada", phone: "08030000001" }], meta);
    await withdrawConsent(v.p1!, ids.ada!, meta, store);
    expect(await prisma.healthProfile.count({ where: { studentId: ids.ada } })).toBe(0);
    expect(await prisma.healthDocument.count({ where: { studentId: ids.ada } })).toBe(0);
    expect(store.removed.some((k) => k.startsWith(`${A}/health/${ids.ada}/`))).toBe(true);
    expect(await withRls(A, (tx) => tx.emergencyContact.count({ where: { studentId: ids.ada } }))).toBe(1);
  });

  it("without HEALTH_DATA_KEY nothing is stored", async () => {
    const k = process.env.HEALTH_DATA_KEY;
    delete process.env.HEALTH_DATA_KEY;
    try {
      await expect(saveProfile(v.p1!, ids.ada!, { data: PROFILE, consent: true }, meta)).rejects.toEqual(new HealthError("notConfigured"));
    } finally {
      process.env.HEALTH_DATA_KEY = k;
    }
  });
});
