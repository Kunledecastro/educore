import { Role, type PrismaClient } from "@educore/db";
import { staffSchema, teacherSchema } from "@/lib/validation/people";
import { parseDayFirstDate, type ColumnDef } from "../csv";
import { ImportRowError } from "../errors";
import type { FieldIssue, ImportContext, Importer } from "../types";
import { pickEnum, zodIssues } from "./shared";

/**
 * Teachers and non-teaching staff in one file, told apart by `role`
 * (teacher / admin / accountant). Upserts on email. An existing person's
 * ROLE is never changed by an import — that's a deliberate admin action on
 * the Staff page (it can remove someone's admin access) — so a mismatch is
 * reported rather than applied.
 */

const COLUMNS: ColumnDef[] = [
  { key: "name", header: "name", aliases: ["full name", "staff name"], required: true, example: "Chinedu Eze" },
  { key: "email", header: "email", aliases: ["email address"], required: true, example: "c.eze@greenfield.edu" },
  { key: "role", header: "role", aliases: ["type", "staff type"], required: true, example: "teacher" },
  { key: "employeeId", header: "employee_id", aliases: ["employee id", "staff id", "staff no"], required: true, example: "GA-T-004" },
  { key: "department", header: "department", required: false, example: "Sciences" },
  { key: "qualification", header: "qualification", required: false, example: "B.Ed Mathematics" },
  { key: "designation", header: "job_title", aliases: ["designation", "job title", "position"], required: false, example: "" },
  { key: "joiningDate", header: "joining_date", aliases: ["date joined", "start date"], required: false, example: "01/09/2026" },
];
const COLUMN_OF: Record<string, string> = Object.fromEntries(COLUMNS.map((c) => [c.key, c.header]));

const ROLES = {
  teacher: Role.TEACHER,
  admin: Role.SCHOOL_ADMIN,
  administrator: Role.SCHOOL_ADMIN,
  "school admin": Role.SCHOOL_ADMIN,
  accountant: Role.ACCOUNTANT,
  bursar: Role.ACCOUNTANT,
  nurse: Role.SCHOOL_NURSE,
  "school nurse": Role.SCHOOL_NURSE,
} as const;

export interface StaffRow {
  role: typeof Role.TEACHER | typeof Role.SCHOOL_ADMIN | typeof Role.ACCOUNTANT | typeof Role.SCHOOL_NURSE;
  name: string;
  email: string;
  employeeId: string;
  department: string | null;
  qualification: string | null;
  designation: string | null;
  joiningDate: Date | null;
}

export interface StaffLookup {
  /** email → role for every user in the school */
  userRoles: Map<string, Role>;
  /** employee id → email, across teacher and staff profiles */
  employeeIds: Map<string, string>;
}

async function loadLookup(tx: PrismaClient, ctx: ImportContext): Promise<StaffLookup> {
  const [users, teachers, staff] = await Promise.all([
    tx.user.findMany({ where: { tenantId: ctx.tenantId }, select: { email: true, role: true } }),
    tx.teacher.findMany({ where: { tenantId: ctx.tenantId }, select: { employeeId: true, user: { select: { email: true } } } }),
    tx.staff.findMany({ where: { tenantId: ctx.tenantId }, select: { employeeId: true, user: { select: { email: true } } } }),
  ]);
  return {
    userRoles: new Map(users.map((u) => [u.email.toLowerCase(), u.role])),
    employeeIds: new Map([...teachers, ...staff].map((p) => [p.employeeId.toUpperCase(), p.user.email.toLowerCase()])),
  };
}

function validate(r: Record<string, string>, lookup: StaffLookup) {
  const issues: FieldIssue[] = [];
  const role = pickEnum(r.role ?? "", ROLES);
  if (!role) issues.push({ column: "role", message: role === null ? "imports.issues.badRole" : "validation.required", params: { value: r.role ?? "" } });

  let joiningDate = "";
  if (r.joiningDate) {
    const iso = parseDayFirstDate(r.joiningDate);
    if (!iso) issues.push({ column: "joining_date", message: "imports.issues.badDate", params: { value: r.joiningDate } });
    else joiningDate = iso;
  }

  const common = { name: r.name ?? "", email: r.email ?? "", employeeId: r.employeeId ?? "", department: r.department ?? "", joiningDate };
  const parsed =
    role === Role.TEACHER
      ? teacherSchema.safeParse({ ...common, qualification: r.qualification ?? "" })
      : staffSchema.safeParse({ ...common, role: role ?? "ACCOUNTANT", designation: r.designation ?? "" });
  if (!parsed.success) issues.push(...zodIssues(parsed.error, COLUMN_OF));

  if (parsed.success && role) {
    const email = parsed.data.email;
    const existingRole = lookup.userRoles.get(email);
    if (existingRole && existingRole !== role) {
      issues.push({ column: "role", message: "imports.issues.roleMismatch", params: { current: existingRole } });
    }
    const empOwner = lookup.employeeIds.get(parsed.data.employeeId);
    if (empOwner && empOwner !== email) issues.push({ column: "employee_id", message: "imports.issues.employeeIdTaken" });
  }

  if (issues.length || !parsed.success || !role) return { issues };
  const d = parsed.data as typeof parsed.data & { qualification?: string; designation?: string };
  const row: StaffRow = {
    role,
    name: d.name,
    email: d.email,
    employeeId: d.employeeId,
    department: d.department ?? null,
    qualification: d.qualification ?? null,
    designation: d.designation ?? null,
    joiningDate: d.joiningDate ?? null,
  };
  return { row, issues };
}

async function apply(tx: PrismaClient, ctx: ImportContext, row: StaffRow) {
  const before = await tx.user.findFirst({
    where: { tenantId: ctx.tenantId, email: row.email },
    include: { teacherProfile: true, staffProfile: true },
  });
  if (before && before.role !== row.role) throw new ImportRowError("imports.issues.roleMismatch");

  const isTeacher = row.role === Role.TEACHER;
  const profile = {
    employeeId: row.employeeId,
    department: row.department,
    ...(row.joiningDate ? { joiningDate: row.joiningDate } : {}),
    ...(isTeacher ? { qualification: row.qualification } : { designation: row.designation }),
  };

  if (!before) {
    const after = await tx.user.create({
      data: {
        tenantId: ctx.tenantId,
        email: row.email,
        name: row.name,
        role: row.role,
        ...(isTeacher
          ? { teacherProfile: { create: { tenantId: ctx.tenantId, ...profile } } }
          : { staffProfile: { create: { tenantId: ctx.tenantId, ...profile } } }),
      },
      include: { teacherProfile: true, staffProfile: true },
    });
    return { outcome: "created" as const, audits: [{ action: "CREATE" as const, entityType: "User", entityId: after.id, after }] };
  }

  const hasProfile = isTeacher ? before.teacherProfile : before.staffProfile;
  const nested = hasProfile ? { update: profile } : { create: { tenantId: ctx.tenantId, ...profile } };
  const after = await tx.user.update({
    where: { id: before.id },
    data: { name: row.name, ...(isTeacher ? { teacherProfile: nested } : { staffProfile: nested }) },
    include: { teacherProfile: true, staffProfile: true },
  });
  return { outcome: "updated" as const, audits: [{ action: "UPDATE" as const, entityType: "User", entityId: after.id, before, after }] };
}

export const staffImporter: Importer<StaffRow, StaffLookup> = {
  kind: "STAFF",
  permission: ["staff", "import"],
  columns: COLUMNS,
  needsYear: false,
  loadLookup,
  validate,
  uniqueKeys: (row) => [
    { key: `email:${row.email}`, column: "email" },
    { key: `emp:${row.employeeId}`, column: "employee_id" },
  ],
  apply,
};
