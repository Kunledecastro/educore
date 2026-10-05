import { randomBytes } from "node:crypto";
import { hashPassword } from "@educore/auth";
import { platformPrisma, Prisma, recordAudit, withRls } from "@educore/db";
import { loginState, loginsAllowedFor, parseStudentLogins, studentInternalEmail, studentUsername, temporaryPassword, type StudentLoginSettings, type StudentLoginState } from "./student-logins";

/**
 * Student logins, database side (Phase 5.0). Everything about students runs
 * in the school's RLS transaction; the school setting lives on the tenants row
 * (platform client, for the session's own school only). Every change is
 * audited; passwords never are.
 */

export interface LoginActor {
  userId: string;
  role: "SCHOOL_ADMIN" | "TEACHER" | string;
  ipAddress: string | null;
  userAgent: string | null;
  impersonatorId?: string | null;
}

export class StudentLoginError extends Error {
  constructor(public readonly code: "notFound" | "notAllowed" | "classNotEnabled" | "notActive" | "noLogin" | "tooMany") {
    super(code);
    this.name = "StudentLoginError";
  }
}

/** Students issued per call: hashing passwords takes a moment each, and requests have a time limit. */
export const MAX_SLIPS_PER_CALL = 20;

const auditCtx = (tenantId: string, a: LoginActor) => ({ tenantId, actorId: a.userId, ipAddress: a.ipAddress, userAgent: a.userAgent, impersonatorId: a.impersonatorId ?? null });

export async function getStudentLoginSettings(tenantId: string): Promise<StudentLoginSettings> {
  const t = await platformPrisma().tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const raw = t?.settings && typeof t.settings === "object" ? (t.settings as Record<string, unknown>) : {};
  return parseStudentLogins(raw.studentLogins);
}

/** Turn logins on/off and choose the classes. Classes must belong to this school. */
export async function saveStudentLoginSettings(tenantId: string, actor: LoginActor, input: StudentLoginSettings) {
  if (actor.role !== "SCHOOL_ADMIN") throw new StudentLoginError("notAllowed");
  const classIds = [...new Set(input.classIds)];
  const valid = await withRls(tenantId, (tx) => tx.classGrade.findMany({ where: { tenantId, id: { in: classIds } }, select: { id: true } }));
  if (valid.length !== classIds.length) throw new StudentLoginError("notFound");
  const next: StudentLoginSettings = { enabled: input.enabled, classIds };
  await platformPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
    const raw = t.settings && typeof t.settings === "object" ? (t.settings as Record<string, unknown>) : {};
    const before = parseStudentLogins(raw.studentLogins);
    await tx.tenant.update({ where: { id: tenantId }, data: { settings: { ...raw, studentLogins: next } as unknown as Prisma.InputJsonValue } });
    await recordAudit(auditCtx(tenantId, actor), { action: "UPDATE", entityType: "Tenant", entityId: tenantId, before: { studentLogins: before }, after: { studentLogins: next } }, tx);
  });
}

/** Sections a person may manage logins for: every section (admins) or the ones they're form teacher of. */
async function manageableSectionIds(tx: Prisma.TransactionClient, tenantId: string, actor: LoginActor): Promise<string[] | "all"> {
  if (actor.role === "SCHOOL_ADMIN") return "all";
  if (actor.role !== "TEACHER") return [];
  const t = await tx.teacher.findFirst({ where: { tenantId, userId: actor.userId }, select: { formSections: { select: { id: true } } } });
  return t?.formSections.map((s) => s.id) ?? [];
}

export interface RosterRow {
  studentId: string;
  name: string;
  admissionNo: string;
  section: string | null;
  state: StudentLoginState;
  consentAt: Date | null;
  lastChanged: Date | null;
}

/** Students of a class (optionally one section) with their login state. */
export async function loginRoster(tenantId: string, actor: LoginActor, classId: string, sectionId?: string): Promise<RosterRow[]> {
  return withRls(tenantId, async (tx) => {
    const allowed = await manageableSectionIds(tx, tenantId, actor);
    const where: Prisma.StudentWhereInput = {
      tenantId,
      classId,
      status: "ACTIVE",
      ...(sectionId ? { sectionId } : {}),
      ...(allowed === "all" ? {} : { sectionId: { in: allowed } }),
    };
    const rows = await tx.student.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        parentConsentAt: true,
        section: { select: { name: true } },
        user: { select: { isActive: true, mustChangePassword: true, passwordHash: true, updatedAt: true } },
      },
    });
    return rows.map((s) => ({
      studentId: s.id,
      name: `${s.firstName} ${s.lastName}`,
      admissionNo: s.admissionNo,
      section: s.section?.name ?? null,
      state: loginState(s.user),
      consentAt: s.parentConsentAt,
      lastChanged: s.user?.updatedAt ?? null,
    }));
  });
}

export interface Slip {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string;
  /** Shown once, on the printed slip. Never stored or logged. */
  password: string;
}

/**
 * Issues logins (first time) or resets passwords, with a one-time password
 * each, and returns the slips to print. Admins: any student in a class with
 * logins on. Form teachers: reset only, for their own form sections.
 */
export async function issueLogins(tenantId: string, actor: LoginActor, studentIds: string[], schoolSlug: string): Promise<Slip[]> {
  const ids = [...new Set(studentIds)];
  if (ids.length === 0) return [];
  if (ids.length > MAX_SLIPS_PER_CALL) throw new StudentLoginError("tooMany");
  const settings = await getStudentLoginSettings(tenantId);

  // Hash outside the transaction (it's the slow part), then write everything at once.
  const prepared = await Promise.all(ids.map(async (id) => {
    const password = temporaryPassword((n) => randomBytes(n));
    return { id, password, hash: await hashPassword(password) };
  }));

  return withRls(tenantId, async (tx) => {
    const allowed = await manageableSectionIds(tx, tenantId, actor);
    const students = await tx.student.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, admissionNo: true, status: true, classId: true, sectionId: true, userId: true, class: { select: { name: true } }, section: { select: { name: true } } },
    });
    if (students.length !== ids.length) throw new StudentLoginError("notFound");
    const slips: Slip[] = [];
    for (const p of prepared) {
      const s = students.find((x) => x.id === p.id)!;
      if (allowed !== "all" && (!s.sectionId || !allowed.includes(s.sectionId))) throw new StudentLoginError("notAllowed");
      if (s.status !== "ACTIVE") throw new StudentLoginError("notActive");
      if (!loginsAllowedFor(settings, s.classId)) throw new StudentLoginError("classNotEnabled");
      const name = `${s.firstName} ${s.lastName}`;
      const username = studentUsername(schoolSlug, s.admissionNo);
      if (s.userId) {
        await tx.user.update({ where: { id: s.userId }, data: { passwordHash: p.hash, mustChangePassword: true, isActive: true, username, name } });
        await recordAudit(auditCtx(tenantId, actor), { action: "UPDATE", entityType: "User", entityId: s.userId, after: { studentLogin: "password reset", studentId: s.id } }, tx);
      } else {
        if (actor.role !== "SCHOOL_ADMIN") throw new StudentLoginError("noLogin"); // teachers reset, admins create
        const key = randomBytes(9).toString("hex");
        const user = await tx.user.create({
          data: { tenantId, role: "STUDENT", name, email: studentInternalEmail(key), username, passwordHash: p.hash, mustChangePassword: true, isActive: true },
          select: { id: true },
        });
        await tx.student.update({ where: { id: s.id }, data: { userId: user.id } });
        await recordAudit(auditCtx(tenantId, actor), { action: "CREATE", entityType: "User", entityId: user.id, after: { studentLogin: "issued", studentId: s.id, username } }, tx);
      }
      slips.push({ studentId: s.id, name, admissionNo: s.admissionNo, className: [s.class?.name, s.section?.name].filter(Boolean).join(" "), password: p.password });
    }
    return slips;
  });
}

/** Switch one student's login off (or back on). The password is kept. */
export async function setLoginActive(tenantId: string, actor: LoginActor, studentId: string, active: boolean) {
  await withRls(tenantId, async (tx) => {
    const allowed = await manageableSectionIds(tx, tenantId, actor);
    const s = await tx.student.findFirst({ where: { tenantId, id: studentId }, select: { userId: true, sectionId: true } });
    if (!s) throw new StudentLoginError("notFound");
    if (allowed !== "all" && (!s.sectionId || !allowed.includes(s.sectionId))) throw new StudentLoginError("notAllowed");
    if (!s.userId) throw new StudentLoginError("noLogin");
    const before = await tx.user.findUniqueOrThrow({ where: { id: s.userId }, select: { isActive: true } });
    await tx.user.update({ where: { id: s.userId }, data: { isActive: active } });
    await recordAudit(auditCtx(tenantId, actor), { action: "UPDATE", entityType: "User", entityId: s.userId, before, after: { isActive: active, studentId } }, tx);
  });
}

/** Record (or withdraw) a parent's consent to their child having a login. */
export async function recordConsent(tenantId: string, actor: LoginActor, studentId: string, given: boolean, now: Date = new Date()) {
  await withRls(tenantId, async (tx) => {
    const allowed = await manageableSectionIds(tx, tenantId, actor);
    const s = await tx.student.findFirst({ where: { tenantId, id: studentId }, select: { sectionId: true, parentConsentAt: true } });
    if (!s) throw new StudentLoginError("notFound");
    if (allowed !== "all" && (!s.sectionId || !allowed.includes(s.sectionId))) throw new StudentLoginError("notAllowed");
    await tx.student.update({ where: { id: studentId }, data: given ? { parentConsentAt: now, parentConsentById: actor.userId } : { parentConsentAt: null, parentConsentById: null } });
    await recordAudit(auditCtx(tenantId, actor), { action: "UPDATE", entityType: "Student", entityId: studentId, before: { parentConsentAt: s.parentConsentAt }, after: { parentConsentAt: given ? now : null } }, tx);
  });
}

/**
 * Is this student allowed in right now? Their login is on, they're active,
 * and their class still has logins on. Checked at sign-in and on every request.
 */
export async function studentMayUseLogin(userId: string): Promise<{ ok: boolean; mustChangePassword: boolean }> {
  const db = platformPrisma();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, mustChangePassword: true, role: true, tenant: { select: { status: true, settings: true } }, studentProfile: { select: { classId: true, status: true } } },
  });
  const student = user?.studentProfile;
  if (!user || user.role !== "STUDENT" || !user.isActive || !student || student.status !== "ACTIVE" || user.tenant?.status !== "ACTIVE") return { ok: false, mustChangePassword: false };
  const raw = user.tenant.settings && typeof user.tenant.settings === "object" ? (user.tenant.settings as Record<string, unknown>) : {};
  return { ok: loginsAllowedFor(parseStudentLogins(raw.studentLogins), student.classId), mustChangePassword: user.mustChangePassword };
}

/** A student chooses their own password (first sign-in, or any time). */
export async function setOwnPassword(userId: string, newPassword: string, meta: { ipAddress: string | null; userAgent: string | null }) {
  const user = await platformPrisma().user.findUnique({ where: { id: userId }, select: { tenantId: true } });
  if (!user?.tenantId) throw new StudentLoginError("notFound");
  const passwordHash = await hashPassword(newPassword);
  await withRls(user.tenantId, async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
    await recordAudit({ tenantId: user.tenantId!, actorId: userId, ...meta }, { action: "UPDATE", entityType: "User", entityId: userId, after: { password: "changed by owner" } }, tx);
  });
}
