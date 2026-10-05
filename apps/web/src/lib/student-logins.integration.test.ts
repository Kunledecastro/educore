import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "@educore/auth";
import { prisma } from "@educore/db";
import { getStudentLoginSettings, issueLogins, loginRoster, recordConsent, saveStudentLoginSettings, setLoginActive, setOwnPassword, StudentLoginError, studentMayUseLogin, type LoginActor } from "./student-logins-data";

/**
 * Student logins against a real Postgres (through migration 0023): off until
 * a school turns them on for classes; admins issue, form teachers only reset
 * their own form section; one-time passwords never stored or audited;
 * switching off (student, class or school) takes effect at once; schools stay
 * separate.
 */

const stamp = Date.now();
let A: string;
let B: string;
const ids: Record<string, string> = {};
const actor = (k: string, role: string): LoginActor => ({ userId: ids[k]!, role, ipAddress: "127.0.0.1", userAgent: "test" });
let slugA: string;

beforeAll(async () => {
  slugA = `sl-a-${stamp}`;
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Logins A", slug: slugA, subdomain: slugA } }),
    prisma.tenant.create({ data: { name: "Logins B", slug: `sl-b-${stamp}`, subdomain: `sl-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  const [jss1, pry5] = await Promise.all(["JSS1", "Primary 5"].map((name) => prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name } })));
  ids.jss1 = jss1!.id;
  ids.pry5 = pry5!.id;
  for (const [k, tenantId, role] of [["admin", A, "SCHOOL_ADMIN"], ["formT", A, "TEACHER"], ["otherT", A, "TEACHER"], ["bAdmin", B, "SCHOOL_ADMIN"]] as const) {
    ids[k] = (await prisma.user.create({ data: { tenantId, email: `${k}-${stamp}@sl.test`, name: k, role } })).id;
  }
  const formT = await prisma.teacher.create({ data: { tenantId: A, userId: ids.formT!, employeeId: `F-${stamp}` } });
  await prisma.teacher.create({ data: { tenantId: A, userId: ids.otherT!, employeeId: `O-${stamp}` } });
  const a1 = await prisma.section.create({ data: { tenantId: A, classId: ids.jss1!, name: "A", formTeacherId: formT.id } });
  const b1 = await prisma.section.create({ data: { tenantId: A, classId: ids.jss1!, name: "B" } });
  const p5 = await prisma.section.create({ data: { tenantId: A, classId: ids.pry5!, name: "A" } });
  const mk = (k: string, adm: string, classId: string, sectionId: string) =>
    prisma.student.create({ data: { tenantId: A, admissionNo: adm, firstName: k, lastName: "Pupil", academicYearId: year.id, classId, sectionId } }).then((s) => (ids[k] = s.id));
  await Promise.all([mk("ada", `GA/26/${stamp}1`, ids.jss1!, a1.id), mk("bayo", `GA/26/${stamp}2`, ids.jss1!, b1.id), mk("chi", `GA/26/${stamp}3`, ids.pry5!, p5.id)]);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined); // audit log is append-only
  await prisma.$disconnect();
});

describe("student logins", () => {
  it("are off until a school admin turns them on for chosen classes", async () => {
    expect(await getStudentLoginSettings(A)).toEqual({ enabled: false, classIds: [] });
    await expect(issueLogins(A, actor("admin", "SCHOOL_ADMIN"), [ids.ada!], slugA)).rejects.toEqual(new StudentLoginError("classNotEnabled"));
    await expect(saveStudentLoginSettings(A, actor("formT", "TEACHER"), { enabled: true, classIds: [ids.jss1!] })).rejects.toEqual(new StudentLoginError("notAllowed"));
    await saveStudentLoginSettings(A, actor("admin", "SCHOOL_ADMIN"), { enabled: true, classIds: [ids.jss1!] });
    expect(await getStudentLoginSettings(A)).toEqual({ enabled: true, classIds: [ids.jss1] });
    await expect(issueLogins(A, actor("admin", "SCHOOL_ADMIN"), [ids.chi!], slugA)).rejects.toEqual(new StudentLoginError("classNotEnabled")); // Primary 5 not ticked
  });

  it("admins issue logins: one-time passwords on slips, never stored or audited", async () => {
    const slips = await issueLogins(A, actor("admin", "SCHOOL_ADMIN"), [ids.ada!, ids.bayo!], slugA);
    expect(slips.map((s) => s.name).sort()).toEqual(["ada Pupil", "bayo Pupil"]);
    const ada = slips.find((s) => s.studentId === ids.ada)!;
    const student = await prisma.student.findUniqueOrThrow({ where: { id: ids.ada }, include: { user: true } });
    expect(student.user).toMatchObject({ role: "STUDENT", tenantId: A, mustChangePassword: true, isActive: true, username: `${slugA}:ga/26/${stamp}1` });
    expect(student.user!.email).toMatch(/@students\.educore\.invalid$/);
    expect(await verifyPassword(student.user!.passwordHash!, ada.password)).toBe(true);
    const audits = await prisma.auditLog.findMany({ where: { tenantId: A, entityType: "User" } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audits)).not.toContain(ada.password);
    expect((await loginRoster(A, actor("admin", "SCHOOL_ADMIN"), ids.jss1!)).map((r) => r.state)).toEqual(["firstSignIn", "firstSignIn"]);
  });

  it("form teachers reset only their own form section, and can't create logins", async () => {
    const r = await issueLogins(A, actor("formT", "TEACHER"), [ids.ada!], slugA);
    expect(r).toHaveLength(1);
    await expect(issueLogins(A, actor("formT", "TEACHER"), [ids.bayo!], slugA)).rejects.toEqual(new StudentLoginError("notAllowed")); // section B
    await expect(issueLogins(A, actor("otherT", "TEACHER"), [ids.ada!], slugA)).rejects.toEqual(new StudentLoginError("notAllowed"));
    expect((await loginRoster(A, actor("formT", "TEACHER"), ids.jss1!)).map((x) => x.name)).toEqual(["ada Pupil"]); // only their section
    expect(await loginRoster(A, actor("otherT", "TEACHER"), ids.jss1!)).toEqual([]);
  });

  it("first sign-in must change the password; switching off works at once (student, class)", async () => {
    const adaUser = (await prisma.student.findUniqueOrThrow({ where: { id: ids.ada } })).userId!;
    expect(await studentMayUseLogin(adaUser)).toEqual({ ok: true, mustChangePassword: true });
    await setOwnPassword(adaUser, "MyOwnPass123", { ipAddress: null, userAgent: null });
    expect(await studentMayUseLogin(adaUser)).toEqual({ ok: true, mustChangePassword: false });

    await setLoginActive(A, actor("formT", "TEACHER"), ids.ada!, false);
    expect((await studentMayUseLogin(adaUser)).ok).toBe(false);
    await setLoginActive(A, actor("admin", "SCHOOL_ADMIN"), ids.ada!, true);
    expect((await studentMayUseLogin(adaUser)).ok).toBe(true);

    await saveStudentLoginSettings(A, actor("admin", "SCHOOL_ADMIN"), { enabled: true, classIds: [] }); // class unticked
    expect((await studentMayUseLogin(adaUser)).ok).toBe(false);
    await saveStudentLoginSettings(A, actor("admin", "SCHOOL_ADMIN"), { enabled: true, classIds: [ids.jss1!] });
    await prisma.student.update({ where: { id: ids.ada }, data: { status: "WITHDRAWN" } });
    expect((await studentMayUseLogin(adaUser)).ok).toBe(false);
    await prisma.student.update({ where: { id: ids.ada }, data: { status: "ACTIVE" } });
    expect((await studentMayUseLogin(ids.admin!)).ok).toBe(false); // not a student at all
  });

  it("records parents' consent", async () => {
    await recordConsent(A, actor("formT", "TEACHER"), ids.ada!, true);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: ids.ada } })).parentConsentById).toBe(ids.formT);
    await recordConsent(A, actor("admin", "SCHOOL_ADMIN"), ids.ada!, false);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: ids.ada } })).parentConsentAt).toBeNull();
  });

  it("another school can't touch these students or classes", async () => {
    await expect(issueLogins(B, actor("bAdmin", "SCHOOL_ADMIN"), [ids.ada!], `sl-b-${stamp}`)).rejects.toEqual(new StudentLoginError("notFound"));
    await expect(saveStudentLoginSettings(B, actor("bAdmin", "SCHOOL_ADMIN"), { enabled: true, classIds: [ids.jss1!] })).rejects.toEqual(new StudentLoginError("notFound"));
    await expect(setLoginActive(B, actor("bAdmin", "SCHOOL_ADMIN"), ids.ada!, false)).rejects.toEqual(new StudentLoginError("notFound"));
    expect(await loginRoster(B, actor("bAdmin", "SCHOOL_ADMIN"), ids.jss1!)).toEqual([]);
  });
});
