import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, CalendarRange } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { ParamSelect } from "@/components/list/param-select";
import { PageHeader } from "@/components/page-header";
import { TimetableGrid } from "@/components/timetable/timetable-grid";
import { todayInTimeZone } from "@/lib/format";
import { requireModule } from "@/lib/guard";
import { studentScopeFor } from "@/lib/student-scope";
import { getSettingsForUser } from "@/lib/tenant";
import { dayNames, loadLessons, loadPeriods } from "@/lib/timetable-data";
import { PrintButton } from "./print-button";
import { SectionEditor } from "./section-editor";
import { TimetableTabs } from "./tabs";

type SP = { view?: string; section?: string; teacher?: string; child?: string };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Timetables (milestone 2.4), by role:
 *   SCHOOL_ADMIN → edit any section's week; view any teacher's week
 *   TEACHER      → their own week (every section they teach)
 *   STUDENT      → their section's week
 *   PARENT       → a chosen child's section week
 * Everything is tenant-scoped; parents only see children linked to them.
 */
export default async function TimetablePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const ctx = await requireModule("timetable");
  const { user, db } = ctx;
  if (ctx.isPlatformAdmin || user.role === Role.ACCOUNTANT) redirect("/dashboard");
  const sp: SP = { view: first(searchParams.view), section: first(searchParams.section), teacher: first(searchParams.teacher), child: first(searchParams.child) };
  const [t, settings] = await Promise.all([getTranslations("timetable"), getSettingsForUser(user.tenantId ?? null)]);
  const days = dayNames(settings.locale);
  const todayDow = todayInTimeZone(settings.timezone).getUTCDay();
  const isAdmin = user.role === Role.SCHOOL_ADMIN;

  const year = await db.academicYear.findFirst({ where: { isActive: true } });
  const periods = await loadPeriods(db);
  const header = (title: string, description?: string, print = true) => (
    <>
      <PageHeader title={title} description={description} actions={print && periods.length ? <PrintButton /> : undefined} />
      {isAdmin ? <TimetableTabs /> : null}
    </>
  );

  if (!year) {
    return (
      <div>
        {header(t("title"), undefined, false)}
        <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noYearTitle")} description={t("noYearDescription")} />
      </div>
    );
  }
  if (periods.filter((p) => !p.isBreak).length === 0) {
    return (
      <div>
        {header(t("title"), undefined, false)}
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title={t("noPeriodsTitle")}
          description={isAdmin ? t("noPeriodsAdmin") : t("noPeriodsOther")}
          action={
            isAdmin ? (
              <Link href="/timetable/periods" className={buttonVariants()}>
                {t("setUpPeriods")}
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  // ---------------- Admin: a teacher's week ----------------
  if (isAdmin && sp.view === "teacher") {
    const teachers = await db.teacher.findMany({
      where: { user: { isActive: true } },
      select: { id: true, user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    });
    const teacher = teachers.find((x) => x.id === sp.teacher) ?? teachers[0];
    const lessons = teacher ? await loadLessons(db, { teacherId: teacher.id, academicYearId: year.id }) : [];
    return (
      <div>
        {header(t("title"), t("description"))}
        {teacher ? (
          <>
            <div className="mb-4">
              <ParamSelect param="teacher" label={t("teacher")} options={teachers.map((x) => ({ value: x.id, label: x.user.name }))} selected={teacher.id} />
            </div>
            <h2 className="mb-2 hidden text-lg font-semibold print:block">{teacher.user.name}</h2>
            <TimetableGrid periods={periods} lessons={lessons} days={days} caption={t("teacherCaption", { teacher: teacher.user.name })} show="section" today={todayDow} breakLabel={t("period")} />
            <p className="mt-2 text-xs text-muted-foreground">{t("lessonsPerWeek", { count: lessons.length })}</p>
          </>
        ) : (
          <EmptyState icon={<CalendarClock className="h-6 w-6" />} title={t("noTeachers")} description="" />
        )}
      </div>
    );
  }

  // ---------------- Admin: edit a section's week ----------------
  if (isAdmin) {
    const sections = await db.section.findMany({
      where: { class: { academicYearId: year.id } },
      orderBy: [{ class: { order: "asc" } }, { class: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, class: { select: { name: true } } },
    });
    const section = sections.find((s) => s.id === sp.section) ?? sections[0];
    if (!section) {
      return (
        <div>
          {header(t("title"), t("description"), false)}
          <EmptyState icon={<CalendarClock className="h-6 w-6" />} title={t("noSections")} description={t("noSectionsHint")} />
        </div>
      );
    }
    const [lessons, assignments] = await Promise.all([
      loadLessons(db, { sectionId: section.id }),
      db.classSectionSubject.findMany({
        where: { sectionId: section.id },
        select: { id: true, subjectId: true, subject: { select: { name: true } }, teacher: { select: { user: { select: { name: true } } } } },
        orderBy: { subject: { name: "asc" } },
      }),
    ]);
    const label = `${section.class.name} ${section.name}`;
    return (
      <div>
        {header(t("title"), t("description"))}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <ParamSelect param="section" label={t("section")} options={sections.map((s) => ({ value: s.id, label: `${s.class.name} ${s.name}` }))} selected={section.id} />
          <p className="text-sm text-muted-foreground print:hidden">{t("editHint")}</p>
        </div>
        <h2 className="mb-2 hidden text-lg font-semibold print:block">{label}</h2>
        {assignments.length === 0 ? <p className="mb-3 text-sm text-destructive">{t("noAssignmentsSection")}</p> : null}
        <SectionEditor
          sectionId={section.id}
          sectionLabel={label}
          periods={periods}
          lessons={lessons}
          days={days}
          today={todayDow}
          assignments={assignments.map((a) => ({
            id: a.id,
            subjectId: a.subjectId,
            subject: a.subject.name,
            teacher: a.teacher.user.name,
            label: `${a.subject.name} — ${a.teacher.user.name}`,
          }))}
        />
      </div>
    );
  }

  // ---------------- Teacher: my week ----------------
  if (user.role === Role.TEACHER) {
    const teacher = await db.teacher.findUnique({ where: { userId: user.id }, select: { id: true } });
    const lessons = teacher ? await loadLessons(db, { teacherId: teacher.id, academicYearId: year.id }) : [];
    return (
      <div>
        {header(t("myTitle"), t("myDescription"))}
        <TimetableGrid periods={periods} lessons={lessons} days={days} caption={t("myTitle")} show="section" today={todayDow} breakLabel={t("period")} />
        <p className="mt-2 text-xs text-muted-foreground">{t("lessonsPerWeek", { count: lessons.length })}</p>
      </div>
    );
  }

  // ---------------- Student / parent: a child's section week ----------------
  const scope = await studentScopeFor(ctx);
  const children = await db.student.findMany({
    where: { AND: [scope, { status: "ACTIVE", academicYearId: year.id, sectionId: { not: null } }] },
    select: { id: true, firstName: true, lastName: true, sectionId: true, section: { select: { name: true, class: { select: { name: true } } } } },
    orderBy: { firstName: "asc" },
  });
  const child = children.find((c) => c.id === sp.child) ?? children[0];
  if (!child || !child.sectionId) {
    return (
      <div>
        {header(t("title"), undefined, false)}
        <EmptyState icon={<CalendarClock className="h-6 w-6" />} title={t("noChildSection")} description="" />
      </div>
    );
  }
  const lessons = await loadLessons(db, { sectionId: child.sectionId });
  const label = `${child.section!.class.name} ${child.section!.name}`;
  return (
    <div>
      {header(user.role === Role.STUDENT ? t("myTitle") : t("childTitle", { name: child.firstName }), label)}
      {user.role === Role.PARENT && children.length > 1 ? (
        <div className="mb-4">
          <ParamSelect param="child" label={t("child")} options={children.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))} selected={child.id} />
        </div>
      ) : null}
      <TimetableGrid periods={periods} lessons={lessons} days={days} caption={t("sectionCaption", { section: label })} show="teacher" today={todayDow} breakLabel={t("period")} />
    </div>
  );
}
