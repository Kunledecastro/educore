import Link from "next/link";
import { CalendarRange, School } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { YearSwitcher } from "@/components/list/year-switcher";
import { resolveAcademicYear } from "@/lib/academic-year";
import { requirePermission } from "@/lib/guard";
import { ClassCard } from "./class-card";
import { NewClassButton } from "./new-class-button";

export default async function ClassesPage({ searchParams }: { searchParams: { year?: string | string[] } }) {
  const { db } = await requirePermission("classGrade", "read", { page: true });
  const t = await getTranslations("academics.classes");
  const { years, selected } = await resolveAcademicYear(db, searchParams.year);

  if (!selected) {
    return (
      <EmptyState
        icon={<CalendarRange className="h-6 w-6" />}
        title={t("noYearTitle")}
        description={t("noYearDescription")}
        action={
          <Link href="/academics" className={buttonVariants()}>
            {t("goToYears")}
          </Link>
        }
      />
    );
  }

  const classes = await db.classGrade.findMany({
    where: { academicYearId: selected.id },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { students: true } },
      sections: {
        orderBy: { name: "asc" },
        include: { _count: { select: { students: true } }, formTeacher: { select: { id: true, user: { select: { name: true } } } } },
      },
    },
  });
  const teachers = (
    await db.teacher.findMany({
      where: { user: { isActive: true } },
      select: { id: true, user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    })
  ).map((tr) => ({ id: tr.id, name: tr.user.name }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <YearSwitcher years={years.map(({ id, name, isActive }) => ({ id, name, isActive }))} selectedId={selected.id} />
        <NewClassButton academicYearId={selected.id} yearName={selected.name} />
      </div>
      {classes.length === 0 ? (
        <EmptyState
          icon={<School className="h-6 w-6" />}
          title={t("emptyTitle", { year: selected.name })}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => (
            <ClassCard
              key={c.id}
              teachers={teachers}
              cls={{
                id: c.id,
                academicYearId: c.academicYearId,
                name: c.name,
                order: c.order,
                studentCount: c._count.students,
                sections: c.sections.map((s) => ({
                  id: s.id,
                  name: s.name,
                  capacity: s.capacity,
                  studentCount: s._count.students,
                  formTeacherId: s.formTeacher?.id ?? null,
                  formTeacherName: s.formTeacher?.user.name ?? null,
                })),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
