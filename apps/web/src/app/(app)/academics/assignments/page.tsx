import Link from "next/link";
import { CalendarRange, UserCog } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@educore/db";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ListFilter } from "@/components/list/list-filter";
import { ListPagination } from "@/components/list/list-pagination";
import { ListSearch } from "@/components/list/list-search";
import { ListToolbar } from "@/components/list/list-toolbar";
import { SortableHeader } from "@/components/list/sortable-header";
import { YearSwitcher } from "@/components/list/year-switcher";
import { resolveAcademicYear } from "@/lib/academic-year";
import { requirePermission } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { AssignmentRowActions, NewAssignmentButton, type SectionGroup } from "./assignment-ui";

export default async function AssignmentsPage({ searchParams }: { searchParams: SearchParamsInput & { year?: string | string[] } }) {
  const { db } = await requirePermission("teacherAssignment", "read");
  const [t, tc, tl] = await Promise.all([
    getTranslations("academics.assignments"),
    getTranslations("academics.classes"),
    getTranslations("list"),
  ]);
  const { years, selected } = await resolveAcademicYear(db, searchParams.year as string | undefined);

  if (!selected) {
    return (
      <EmptyState
        icon={<CalendarRange className="h-6 w-6" />}
        title={tc("noYearTitle")}
        description={tc("noYearDescription")}
        action={
          <Link href="/academics" className={buttonVariants()}>
            {tc("goToYears")}
          </Link>
        }
      />
    );
  }

  const [classes, subjects, teachers] = await Promise.all([
    db.classGrade.findMany({
      where: { academicYearId: selected.id },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: { sections: { orderBy: { name: "asc" } } },
    }),
    db.subject.findMany({ orderBy: { name: "asc" } }),
    db.teacher.findMany({ include: { user: { select: { name: true, isActive: true } } }, orderBy: { user: { name: "asc" } } }),
  ]);

  const params = parseListParams(searchParams, {
    sortable: ["section", "subject", "teacher"] as const,
    defaultSort: "section" as const,
    filters: {
      classId: classes.map((c) => c.id),
      subjectId: subjects.map((s) => s.id),
      teacherId: teachers.map((x) => x.id),
    },
  });

  const where: Prisma.ClassSectionSubjectWhereInput = {
    section: { class: { academicYearId: selected.id, ...(params.filters.classId ? { id: params.filters.classId } : {}) } },
    ...(params.filters.subjectId ? { subjectId: params.filters.subjectId } : {}),
    ...(params.filters.teacherId ? { teacherId: params.filters.teacherId } : {}),
    ...(params.q
      ? {
          OR: [
            { subject: { name: { contains: params.q, mode: "insensitive" } } },
            { teacher: { user: { name: { contains: params.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.ClassSectionSubjectOrderByWithRelationInput[] =
    params.sort === "subject"
      ? [{ subject: { name: params.dir } }]
      : params.sort === "teacher"
        ? [{ teacher: { user: { name: params.dir } } }]
        : [{ section: { class: { order: params.dir } } }, { section: { class: { name: params.dir } } }, { section: { name: params.dir } }];

  const [total, rows] = await Promise.all([
    db.classSectionSubject.count({ where }),
    db.classSectionSubject.findMany({
      where,
      orderBy: [...orderBy, { id: "asc" }],
      skip: params.skip,
      take: params.take,
      include: {
        subject: true,
        section: { include: { class: true } },
        teacher: { include: { user: { select: { name: true } } } },
      },
    }),
  ]);

  const sectionGroups: SectionGroup[] = classes
    .filter((c) => c.sections.length > 0)
    .map((c) => ({ className: c.name, sections: c.sections.map((s) => ({ id: s.id, label: `${c.name} ${s.name}` })) }));
  const subjectOptions = subjects.map((s) => ({ id: s.id, label: `${s.name} (${s.code})` }));
  const teacherOptions = teachers
    .filter((x) => x.user.isActive)
    .map((x) => ({ id: x.id, label: `${x.user.name} · ${x.employeeId}` }));
  const canAssign = sectionGroups.length > 0 && subjectOptions.length > 0 && teacherOptions.length > 0;
  const filtered = Boolean(params.q || params.filters.classId || params.filters.subjectId || params.filters.teacherId);

  const newButton = canAssign ? (
    <NewAssignmentButton sectionGroups={sectionGroups} subjects={subjectOptions} teachers={teacherOptions} />
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <YearSwitcher years={years.map(({ id, name, isActive }) => ({ id, name, isActive }))} selectedId={selected.id} />
        {newButton}
      </div>
      {!canAssign ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t("prerequisites")}</p> : null}

      {total === 0 && !filtered ? (
        <EmptyState
          icon={<UserCog className="h-6 w-6" />}
          title={t("emptyTitle", { year: selected.name })}
          description={t("emptyDescription")}
          action={newButton}
        />
      ) : (
        <>
          <ListToolbar>
            <ListSearch placeholder={t("searchPlaceholder")} />
            <ListFilter name="classId" label={t("classFilter")} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            <ListFilter name="subjectId" label={t("subjectFilter")} options={subjects.map((s) => ({ value: s.id, label: s.name }))} />
            <ListFilter name="teacherId" label={t("teacherFilter")} options={teachers.map((x) => ({ value: x.id, label: x.user.name }))} />
          </ListToolbar>
          {rows.length === 0 ? (
            <EmptyState icon={<UserCog className="h-6 w-6" />} title={tl("noResults")} description={tl("noResultsHint")} />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader column="section" label={t("section")} defaultSort="section" />
                    <SortableHeader column="subject" label={t("subject")} defaultSort="section" />
                    <SortableHeader column="teacher" label={t("teacher")} defaultSort="section" />
                    <TableHead>
                      <span className="sr-only">{t("reassign")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const sectionLabel = `${r.section.class.name} ${r.section.name}`;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{sectionLabel}</TableCell>
                        <TableCell>
                          {r.subject.name} <span className="font-mono text-xs text-muted-foreground">{r.subject.code}</span>
                        </TableCell>
                        <TableCell>{r.teacher.user.name}</TableCell>
                        <TableCell>
                          <AssignmentRowActions
                            assignment={{
                              id: r.id,
                              teacherId: r.teacherId,
                              teacherName: r.teacher.user.name,
                              subjectName: r.subject.name,
                              sectionLabel,
                            }}
                            teachers={teacherOptions}
                          />
                        </TableCell>
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
