import { Role, type PrismaClient } from "@educore/db";
import { emailSchema, studentSchema } from "@/lib/validation/people";
import { parseDayFirstDate, type ColumnDef } from "../csv";
import { ImportRowError } from "../errors";
import type { AuditEntry, FieldIssue, ImportContext, Importer } from "../types";
import { norm, pickEnum, zodIssues } from "./shared";
import { hasStudentCapacity, loadEntitlements } from "@/lib/entitlements-data";

/**
 * Students, optionally with one parent/guardian per row. Upserts on
 * admission number: re-importing a corrected file updates students rather
 * than duplicating them. The parent is matched on email — siblings share a
 * parent by using the same email — created if new, and linked if not yet
 * linked. Existing parents' names are never overwritten by a CSV.
 */

const COLUMNS: ColumnDef[] = [
  { key: "admissionNo", header: "admission_no", aliases: ["admission number", "admission no", "adm no", "reg no"], required: true, example: "GA-2026-0013" },
  { key: "firstName", header: "first_name", aliases: ["first name", "firstname", "given name"], required: true, example: "Adaeze" },
  { key: "lastName", header: "last_name", aliases: ["last name", "surname", "family name"], required: true, example: "Okafor" },
  { key: "class", header: "class", aliases: ["class name", "grade"], required: true, example: "Grade 5" },
  { key: "section", header: "section", aliases: ["arm", "stream"], required: false, example: "A" },
  { key: "gender", header: "gender", aliases: ["sex"], required: false, example: "Female" },
  { key: "dateOfBirth", header: "date_of_birth", aliases: ["dob", "birth date", "date of birth"], required: false, example: "07/03/2016" },
  { key: "admissionDate", header: "admission_date", aliases: ["date admitted", "admission date"], required: false, example: "01/09/2026" },
  { key: "guardianName", header: "guardian_name", aliases: ["parent name", "guardian name"], required: false, example: "Ngozi Okafor" },
  { key: "guardianEmail", header: "guardian_email", aliases: ["parent email", "guardian email"], required: false, example: "ngozi.okafor@example.com" },
  { key: "guardianPhone", header: "guardian_phone", aliases: ["parent phone", "guardian phone"], required: false, example: "+2348012345678" },
  { key: "guardianRelationship", header: "guardian_relationship", aliases: ["relationship"], required: false, example: "Mother" },
];

const COLUMN_OF: Record<string, string> = Object.fromEntries(COLUMNS.map((c) => [c.key, c.header]));
COLUMN_OF.classId = "class";
COLUMN_OF.sectionId = "section";

const GENDERS = { f: "FEMALE", female: "FEMALE", m: "MALE", male: "MALE", other: "OTHER" } as const;
const RELATIONSHIPS = { mother: "MOTHER", mum: "MOTHER", mom: "MOTHER", father: "FATHER", dad: "FATHER", guardian: "GUARDIAN", other: "OTHER" } as const;

export interface StudentRow {
  admissionNo: string;
  firstName: string;
  lastName: string;
  classId: string;
  sectionId: string | null;
  academicYearId: string;
  gender: "FEMALE" | "MALE" | "OTHER" | null;
  dateOfBirth: Date | null;
  admissionDate: Date | null;
  guardian: { email: string; name: string | null; phone: string | null; relationship: "MOTHER" | "FATHER" | "GUARDIAN" | "OTHER" } | null;
}

export interface StudentLookup {
  academicYearId: string;
  /** "class name" → { id, sections: "section name" → id } */
  classes: Map<string, { id: string; sections: Map<string, string> }>;
  /** email → role, for every user in this school */
  userRoles: Map<string, Role>;
}

async function loadLookup(tx: PrismaClient, ctx: ImportContext): Promise<StudentLookup> {
  const academicYearId = ctx.options.academicYearId;
  if (!academicYearId) throw new Error("Student import needs an academic year");
  const [classes, users] = await Promise.all([
    tx.classGrade.findMany({
      where: { tenantId: ctx.tenantId, academicYearId },
      select: { id: true, name: true, sections: { select: { id: true, name: true } } },
    }),
    tx.user.findMany({ where: { tenantId: ctx.tenantId }, select: { email: true, role: true } }),
  ]);
  return {
    academicYearId,
    classes: new Map(classes.map((c) => [norm(c.name), { id: c.id, sections: new Map(c.sections.map((s) => [norm(s.name), s.id])) }])),
    userRoles: new Map(users.map((u) => [u.email.toLowerCase(), u.role])),
  };
}

function validate(r: Record<string, string>, lookup: StudentLookup, seen: Set<string>) {
  const issues: FieldIssue[] = [];

  const cls = lookup.classes.get(norm(r.class ?? ""));
  if (r.class && !cls) issues.push({ column: "class", message: "imports.issues.unknownClass", params: { value: r.class } });
  let sectionId: string | undefined;
  if (cls && r.section) {
    sectionId = cls.sections.get(norm(r.section));
    if (!sectionId) issues.push({ column: "section", message: "imports.issues.unknownSection", params: { value: r.section, class: r.class ?? "" } });
  }

  const gender = pickEnum(r.gender ?? "", GENDERS);
  if (gender === null) issues.push({ column: "gender", message: "imports.issues.badGender", params: { value: r.gender ?? "" } });

  const dates: Record<"dateOfBirth" | "admissionDate", string> = { dateOfBirth: "", admissionDate: "" };
  for (const k of ["dateOfBirth", "admissionDate"] as const) {
    if (r[k]) {
      const iso = parseDayFirstDate(r[k]!);
      if (!iso) issues.push({ column: COLUMN_OF[k]!, message: "imports.issues.badDate", params: { value: r[k]! } });
      else dates[k] = iso;
    }
  }

  const parsed = studentSchema.safeParse({
    admissionNo: r.admissionNo ?? "",
    firstName: r.firstName ?? "",
    lastName: r.lastName ?? "",
    classId: cls?.id ?? (r.class ? "unknown" : ""),
    sectionId: sectionId ?? "",
    gender: gender ?? "",
    dateOfBirth: dates.dateOfBirth,
    admissionDate: dates.admissionDate,
  });
  if (!parsed.success) issues.push(...zodIssues(parsed.error, COLUMN_OF).filter((i) => i.column !== "class" || !r.class));

  // Parent/guardian: optional, but if any guardian column is filled the email is required.
  let guardian: StudentRow["guardian"] = null;
  const anyGuardian = Boolean(r.guardianName || r.guardianEmail || r.guardianPhone || r.guardianRelationship);
  if (anyGuardian) {
    const email = emailSchema.safeParse(r.guardianEmail ?? "");
    const relationship = pickEnum(r.guardianRelationship ?? "", RELATIONSHIPS);
    if (!email.success) issues.push({ column: "guardian_email", message: r.guardianEmail ? "validation.email" : "imports.issues.guardianEmailRequired" });
    if (relationship === null) issues.push({ column: "guardian_relationship", message: "imports.issues.badRelationship", params: { value: r.guardianRelationship ?? "" } });
    if (email.success) {
      const existingRole = lookup.userRoles.get(email.data);
      if (existingRole && existingRole !== Role.PARENT) {
        issues.push({ column: "guardian_email", message: "imports.issues.emailNotParent" });
      } else if (!existingRole && !seen.has(`parent:${email.data}`) && !r.guardianName) {
        issues.push({ column: "guardian_name", message: "imports.issues.guardianNameRequired" });
      }
      if (r.guardianPhone && !/^\+?[0-9(][0-9 ()-]{5,18}[0-9]$/.test(r.guardianPhone)) {
        issues.push({ column: "guardian_phone", message: "validation.phone" });
      }
      guardian = {
        email: email.data,
        name: r.guardianName?.trim() || null,
        phone: r.guardianPhone?.trim() || null,
        relationship: relationship ?? "GUARDIAN",
      };
    }
  }

  if (issues.length || !parsed.success || !cls) return { issues };
  const d = parsed.data;
  const row: StudentRow = {
    admissionNo: d.admissionNo,
    firstName: d.firstName,
    lastName: d.lastName,
    classId: cls.id,
    sectionId: sectionId ?? null,
    academicYearId: lookup.academicYearId,
    gender: d.gender ?? null,
    dateOfBirth: d.dateOfBirth ?? null,
    admissionDate: d.admissionDate ?? null,
    guardian,
  };
  return { row, issues };
}

async function apply(tx: PrismaClient, ctx: ImportContext, row: StudentRow) {
  const audits: AuditEntry[] = [];
  const data = {
    firstName: row.firstName,
    lastName: row.lastName,
    classId: row.classId,
    sectionId: row.sectionId,
    academicYearId: row.academicYearId,
    ...(row.gender ? { gender: row.gender } : {}),
    ...(row.dateOfBirth ? { dateOfBirth: row.dateOfBirth } : {}),
    ...(row.admissionDate ? { admissionDate: row.admissionDate } : {}),
  };

  const before = await tx.student.findFirst({ where: { tenantId: ctx.tenantId, admissionNo: row.admissionNo } });
  // The plan's student limit (4.1): new students past it are refused row by row; updates always go through.
  if (!before && !(await hasStudentCapacity(tx, ctx.tenantId, (await loadEntitlements(ctx.tenantId)).maxStudents))) {
    throw new ImportRowError("imports.issues.studentLimit");
  }
  const student = before
    ? await tx.student.update({ where: { id: before.id }, data })
    : await tx.student.create({ data: { ...data, tenantId: ctx.tenantId, admissionNo: row.admissionNo } });
  audits.push({ action: before ? "UPDATE" : "CREATE", entityType: "Student", entityId: student.id, before: before ?? undefined, after: student });

  if (row.guardian) {
    const g = row.guardian;
    let parent = await tx.user.findFirst({ where: { tenantId: ctx.tenantId, email: g.email }, include: { guardianProfile: true } });
    if (parent && parent.role !== Role.PARENT) throw new ImportRowError("imports.issues.emailNotParent");
    if (!parent) {
      if (!g.name) throw new ImportRowError("imports.issues.guardianNameRequired");
      parent = await tx.user.create({
        data: {
          tenantId: ctx.tenantId,
          email: g.email,
          name: g.name,
          role: Role.PARENT,
          guardianProfile: { create: { tenantId: ctx.tenantId, phone: g.phone } },
        },
        include: { guardianProfile: true },
      });
      audits.push({ action: "CREATE", entityType: "User", entityId: parent.id, after: parent });
    } else if (!parent.guardianProfile) {
      await tx.guardian.create({ data: { tenantId: ctx.tenantId, userId: parent.id, phone: g.phone } });
      parent = await tx.user.findFirstOrThrow({ where: { id: parent.id }, include: { guardianProfile: true } });
    }
    const guardianId = parent.guardianProfile!.id;
    const existingLink = await tx.studentGuardian.findFirst({ where: { tenantId: ctx.tenantId, studentId: student.id, guardianId } });
    if (!existingLink) {
      const hasPrimary = (await tx.studentGuardian.count({ where: { tenantId: ctx.tenantId, studentId: student.id, isPrimary: true } })) > 0;
      const link = await tx.studentGuardian.create({
        data: { tenantId: ctx.tenantId, studentId: student.id, guardianId, relationship: g.relationship, isPrimary: !hasPrimary },
      });
      audits.push({ action: "CREATE", entityType: "StudentGuardian", entityId: link.id, after: link });
    }
  }

  return { outcome: before ? ("updated" as const) : ("created" as const), audits };
}

export const studentsImporter: Importer<StudentRow, StudentLookup> = {
  kind: "STUDENTS",
  permission: ["student", "import"],
  columns: COLUMNS,
  needsYear: true,
  loadLookup,
  validate,
  uniqueKeys: (row) => [{ key: `admission:${row.admissionNo}`, column: "admission_no" }],
  introduces: (row) => (row.guardian ? [`parent:${row.guardian.email}`] : []),
  apply,
};
