import { NextResponse, type NextRequest } from "next/server";
import { can, type Resource } from "@educore/auth";
import { Role, type Prisma } from "@educore/db";
import { resolveAcademicYear } from "@/lib/academic-year";
import { exportFileName, MAX_EXPORT_ROWS, renderExport, type ExportTable } from "@/lib/exports";
import { ForbiddenError, requireUser, UnauthenticatedError, type RequestContext } from "@/lib/guard";
import { parseListParams } from "@/lib/list-params";
import { studentScopeFor } from "@/lib/student-scope";
import { getSettingsForUser, getTenantForUser } from "@/lib/tenant";
import { attendanceSummaries, loadRegisterSection, sectionStudents } from "@/lib/attendance-data";
import { todayInTimeZone } from "@/lib/format";
import { NotFoundError } from "@/lib/run-action";
import { resolveTermRange } from "@/lib/term-range";
import { loadGradebook } from "@/lib/gradebook";
import { STUDENT_STATUSES } from "@/lib/validation/people";

export const dynamic = "force-dynamic";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * GET /api/exports/{students|staff|parents|attendance|scores}?format=csv|xlsx&…list filters
 *
 * Same permission checks and row scope as the list pages, and the same
 * filters (the Export button passes the page's query string), so you export
 * exactly what you're looking at. Column names match the import templates.
 */
const EXPORTS: Record<string, { permission: Resource; build: (ctx: RequestContext, sp: URLSearchParams) => Promise<ExportTable> }> = {
  students: {
    permission: "student",
    async build(ctx, sp) {
      const scope = await studentScopeFor(ctx);
      const schoolWide = ctx.user.role === Role.SCHOOL_ADMIN || ctx.user.role === Role.ACCOUNTANT;
      const { selected } = schoolWide ? await resolveAcademicYear(ctx.db, sp.get("year") ?? undefined) : { selected: null };
      const classes = selected ? await ctx.db.classGrade.findMany({ where: { academicYearId: selected.id }, select: { id: true } }) : [];
      const p = parseListParams(sp, {
        sortable: ["lastName"] as const,
        defaultSort: "lastName" as const,
        filters: { classId: classes.map((c) => c.id), status: STUDENT_STATUSES },
      });
      const where: Prisma.StudentWhereInput = {
        AND: [
          scope,
          selected ? { academicYearId: selected.id } : {},
          p.filters.classId ? { classId: p.filters.classId } : {},
          p.filters.status ? { status: p.filters.status as (typeof STUDENT_STATUSES)[number] } : {},
          p.q
            ? {
                OR: [
                  { firstName: { contains: p.q, mode: "insensitive" } },
                  { lastName: { contains: p.q, mode: "insensitive" } },
                  { admissionNo: { contains: p.q, mode: "insensitive" } },
                ],
              }
            : {},
        ],
      };
      const students = await ctx.db.student.findMany({
        where,
        orderBy: [{ class: { order: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
        take: MAX_EXPORT_ROWS,
        include: {
          class: { select: { name: true } },
          section: { select: { name: true } },
          guardians: {
            orderBy: { isPrimary: "desc" },
            take: 1,
            include: { guardian: { include: { user: { select: { name: true, email: true } } } } },
          },
        },
      });
      // Parents and teachers get the student columns only — not other families' contact details.
      const withGuardian = schoolWide;
      const headers = [
        "admission_no", "first_name", "last_name", "class", "section", "gender", "date_of_birth", "admission_date", "status",
        ...(withGuardian ? ["guardian_name", "guardian_email", "guardian_phone", "guardian_relationship"] : []),
      ];
      return {
        sheetName: "Students",
        headers,
        rows: students.map((s) => {
          const g = s.guardians[0];
          return [
            s.admissionNo, s.firstName, s.lastName, s.class?.name, s.section?.name, s.gender, iso(s.dateOfBirth), iso(s.admissionDate), s.status,
            ...(withGuardian ? [g?.guardian.user.name, g?.guardian.user.email, g?.guardian.phone, g?.relationship] : []),
          ];
        }),
      };
    },
  },
  staff: {
    permission: "staff",
    async build(ctx) {
      const users = await ctx.db.user.findMany({
        where: { role: { in: [Role.TEACHER, Role.SCHOOL_ADMIN, Role.ACCOUNTANT] } },
        orderBy: [{ role: "asc" }, { name: "asc" }],
        take: MAX_EXPORT_ROWS,
        include: { teacherProfile: true, staffProfile: true },
      });
      const roleName = { TEACHER: "teacher", SCHOOL_ADMIN: "admin", ACCOUNTANT: "accountant" } as Record<string, string>;
      return {
        sheetName: "Staff",
        headers: ["name", "email", "role", "employee_id", "department", "qualification", "job_title", "joining_date", "active"],
        rows: users.map((u) => {
          const p = u.teacherProfile ?? u.staffProfile;
          return [
            u.name, u.email, roleName[u.role], p?.employeeId, p?.department, u.teacherProfile?.qualification,
            u.staffProfile?.designation, iso(p?.joiningDate), u.isActive ? "yes" : "no",
          ];
        }),
      };
    },
  },
  attendance: {
    permission: "attendance",
    // One section's attendance for a term (?sectionId=&term=), same access rule as its register.
    async build(ctx, sp) {
      const section = await loadRegisterSection(ctx, sp.get("sectionId") ?? "");
      const settings = await getSettingsForUser(ctx.user.tenantId ?? null);
      const range = await resolveTermRange(ctx.db, section.class.academicYear, sp.get("term") ?? undefined, todayInTimeZone(settings.timezone));
      const students = await sectionStudents(ctx.db, section.id);
      const summaries = await attendanceSummaries(ctx.db, students.map((s) => s.id), range);
      return {
        sheetName: "Attendance",
        headers: ["admission_no", "last_name", "first_name", "class", "section", "period", "from", "to", "present", "absent", "late", "excused", "days_marked", "attendance_rate_percent"],
        rows: students.map((s) => {
          const c = summaries.get(s.id)!;
          return [
            s.admissionNo, s.lastName, s.firstName, section.class.name, section.name, range.label, iso(range.from), iso(range.to),
            c.present, c.absent, c.late, c.excused, c.marked, c.rate ?? "",
          ];
        }),
      };
    },
  },
  scores: {
    permission: "mark",
    // One gradebook (?sectionId=&subjectId=&term=); same access rule as the gradebook. Re-importable.
    async build(ctx, sp) {
      const settings = await getSettingsForUser(ctx.user.tenantId ?? null);
      const book = await loadGradebook(ctx, sp.get("sectionId") ?? "", sp.get("subjectId") ?? "", sp.get("term") ?? undefined, settings.timezone);
      return {
        sheetName: `${book.subject.code} ${book.section.class.name} ${book.section.name}`,
        headers: ["admission_no", "last_name", "first_name", ...book.components.map((c) => c.name), "total", "grade", "remark"],
        rows: book.rows.map((r) => [
          r.student.admissionNo,
          r.student.lastName,
          r.student.firstName,
          ...book.components.map((c) => r.scores[c.id] ?? ""),
          r.total.total ?? "",
          r.grade?.grade ?? "",
          r.grade?.remark ?? "",
        ]),
      };
    },
  },
  parents: {
    permission: "guardian",
    async build(ctx) {
      const users = await ctx.db.user.findMany({
        where: { role: Role.PARENT },
        orderBy: { name: "asc" },
        take: MAX_EXPORT_ROWS,
        include: {
          guardianProfile: {
            include: { students: { include: { student: { select: { admissionNo: true, firstName: true, lastName: true } } } } },
          },
        },
      });
      return {
        sheetName: "Parents",
        headers: ["name", "email", "phone", "occupation", "children", "children_admission_nos", "active"],
        rows: users.map((u) => {
          const kids = u.guardianProfile?.students.map((l) => l.student) ?? [];
          return [
            u.name, u.email, u.guardianProfile?.phone, u.guardianProfile?.occupation,
            kids.map((k) => `${k.firstName} ${k.lastName}`).join("; "), kids.map((k) => k.admissionNo).join("; "), u.isActive ? "yes" : "no",
          ];
        }),
      };
    },
  },
};

export async function GET(req: NextRequest, { params }: { params: { kind: string } }) {
  const spec = EXPORTS[params.kind];
  if (!spec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const ctx = await requireUser();
    if (!can(ctx.user.role, spec.permission, "export") || ctx.isPlatformAdmin) throw new ForbiddenError();
    // Staff export includes teachers, so it needs both permissions.
    if (params.kind === "staff" && !can(ctx.user.role, "teacher", "export")) throw new ForbiddenError();

    const sp = req.nextUrl.searchParams;
    const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";
    const table = await spec.build(ctx, sp);
    const file = await renderExport(table, format);
    const { tenant } = await getTenantForUser(ctx.user.tenantId ?? null);
    return new NextResponse(file.body as BodyInit, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${exportFileName(params.kind, tenant?.name, file.ext)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("[export] failed", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
