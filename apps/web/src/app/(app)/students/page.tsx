import Link from "next/link";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Role, type Prisma } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ListFilter } from "@/components/list/list-filter";
import { ListPagination } from "@/components/list/list-pagination";
import { ListSearch } from "@/components/list/list-search";
import { ListToolbar } from "@/components/list/list-toolbar";
import { SortableHeader } from "@/components/list/sortable-header";
import { YearSwitcher } from "@/components/list/year-switcher";
import { ExportMenu } from "@/components/list/export-menu";
import { PageHeader } from "@/components/page-header";
import { resolveAcademicYear } from "@/lib/academic-year";
import { requirePermission } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { studentScopeFor } from "@/lib/student-scope";
import { toDateInput } from "@/lib/validation/common";
import { STUDENT_STATUSES } from "@/lib/validation/people";
import { classOptionsFor } from "./load-classes";
import { STATUS_BADGE } from "./status-badge";
import { NewStudentButton, StudentRowActions } from "./student-ui";

export default async function StudentsPage({ searchParams }: { searchParams: SearchParamsInput & { year?: string | string[] } }) {
  const ctx = await requirePermission("student", "read", { page: true });
  const { db, user } = ctx;
  const t = await getTranslations("students");
  const tl = await getTranslations("list");

  // Admins and accountants browse the whole school one year at a time; parents
  // and teachers just see "their" students (the row scope does the filtering).
  const schoolWide = user.role === Role.SCHOOL_ADMIN || user.role === Role.ACCOUNTANT || user.role === Role.PLATFORM_ADMIN;
  const canManage = can(user.role, "student", "update") && user.role !== Role.PLATFORM_ADMIN;
  const scope = await studentScopeFor(ctx);
  const { years, selected } = schoolWide ? await resolveAcademicYear(db, searchParams.year) : { years: [], selected: null };
  const classes = selected ? await classOptionsFor(db, selected.id) : [];

  const params = parseListParams(searchParams, {
    sortable: ["lastName", "admissionNo", "class"] as const,
    defaultSort: "lastName" as const,
    filters: { classId: classes.map((c) => c.id), status: STUDENT_STATUSES },
  });

  const base: Prisma.StudentWhereInput = { AND: [scope, selected ? { academicYearId: selected.id } : {}] };
  const where: Prisma.StudentWhereInput = {
    AND: [
      base,
      params.filters.classId ? { classId: params.filters.classId } : {},
      params.filters.status ? { status: params.filters.status as (typeof STUDENT_STATUSES)[number] } : {},
      params.q
        ? {
            OR: [
              { firstName: { contains: params.q, mode: "insensitive" } },
              { lastName: { contains: params.q, mode: "insensitive" } },
              { admissionNo: { contains: params.q, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  const orderBy: Prisma.StudentOrderByWithRelationInput[] =
    params.sort === "admissionNo"
      ? [{ admissionNo: params.dir }]
      : params.sort === "class"
        ? [{ class: { order: params.dir } }, { class: { name: params.dir } }, { lastName: "asc" }]
        : [{ lastName: params.dir }, { firstName: params.dir }];

  const [total, all, students] = await Promise.all([
    db.student.count({ where }),
    db.student.count({ where: base }),
    db.student.findMany({
      where,
      orderBy: [...orderBy, { id: "asc" }],
      skip: params.skip,
      take: params.take,
      include: { class: { select: { name: true } }, section: { select: { name: true } } },
    }),
  ]);

  const title = user.role === Role.PARENT ? t("titleParent") : user.role === Role.TEACHER ? t("titleTeacher") : t("title");
  const description =
    user.role === Role.PARENT ? t("descriptionParent") : user.role === Role.TEACHER ? t("descriptionTeacher") : t("description");
  const newButton = canManage && classes.length > 0 ? <NewStudentButton classes={classes} /> : null;
  const canExport = can(user.role, "student", "export") && user.role !== Role.PLATFORM_ADMIN;

  let empty: React.ReactNode = null;
  if (all === 0) {
    if (user.role === Role.PARENT) empty = <EmptyState icon={<Users className="h-6 w-6" />} title={title} description={t("emptyParent")} />;
    else if (user.role === Role.TEACHER) empty = <EmptyState icon={<Users className="h-6 w-6" />} title={title} description={t("emptyTeacher")} />;
    else if (canManage && selected && classes.length === 0)
      empty = (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={t("emptyTitle", { year: selected.name })}
          description={t("needClasses", { year: selected.name })}
          action={
            <Link href="/academics/classes" className={buttonVariants()}>
              {t("goToClasses")}
            </Link>
          }
        />
      );
    else
      empty = (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={t("emptyTitle", { year: selected?.name ?? "" })}
          description={t("emptyDescription")}
          action={newButton}
        />
      );
  }

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          all > 0 ? (
            <>
              {canExport ? <ExportMenu kind="students" /> : null}
              {newButton}
            </>
          ) : null
        }
      />
      {selected && years.length > 1 ? (
        <div className="mb-4">
          <YearSwitcher years={years.map(({ id, name, isActive }) => ({ id, name, isActive }))} selectedId={selected.id} />
        </div>
      ) : null}
      {empty ?? (
        <>
          <ListToolbar>
            <ListSearch placeholder={t("searchPlaceholder")} />
            {schoolWide ? (
              <ListFilter name="classId" label={t("classFilter")} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            ) : null}
            <ListFilter name="status" label={t("statusFilter")} options={STUDENT_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
          </ListToolbar>
          {students.length === 0 ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title={tl("noResults")} description={tl("noResultsHint")} />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader column="lastName" label={t("name")} defaultSort="lastName" />
                    <SortableHeader column="admissionNo" label={t("admissionNo")} defaultSort="lastName" className="hidden sm:table-cell" />
                    <SortableHeader column="class" label={t("class")} defaultSort="lastName" />
                    <TableHead className="hidden md:table-cell">{t("gender")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    {canManage ? (
                      <TableHead>
                        <span className="sr-only">{t("view")}</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((s) => {
                    const name = `${s.firstName} ${s.lastName}`;
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Link href={`/students/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                            {s.lastName}, {s.firstName}
                          </Link>
                          <div className="font-mono text-xs text-muted-foreground sm:hidden">{s.admissionNo}</div>
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs sm:table-cell">{s.admissionNo}</TableCell>
                        <TableCell>
                          {s.class?.name ?? "—"}
                          {s.section ? ` ${s.section.name}` : ""}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {s.gender && (["FEMALE", "MALE", "OTHER"] as const).includes(s.gender.toUpperCase() as never)
                            ? t(`genders.${s.gender.toUpperCase() as "FEMALE" | "MALE" | "OTHER"}`)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_BADGE[s.status]}>{t(`statuses.${s.status}`)}</Badge>
                        </TableCell>
                        {canManage ? (
                          <TableCell>
                            <StudentRowActions
                              classes={classes}
                              student={{
                                id: s.id,
                                name,
                                status: s.status,
                                admissionNo: s.admissionNo,
                                firstName: s.firstName,
                                lastName: s.lastName,
                                dateOfBirth: toDateInput(s.dateOfBirth),
                                gender: s.gender?.toUpperCase() ?? "",
                                classId: s.classId ?? "",
                                sectionId: s.sectionId ?? "",
                                admissionDate: toDateInput(s.admissionDate),
                              }}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <ListPagination page={params.page} pageSize={params.pageSize} total={total} />
        </>
      )}
    </div>
  );
}
