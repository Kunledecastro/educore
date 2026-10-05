import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, CalendarRange } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Role } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { buttonVariants } from "@educore/ui/button";
import { Card, CardContent } from "@educore/ui/card";
import { EmptyState } from "@educore/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { canEditRegister, isSchoolDay, parseDateParam, registerState } from "@/lib/attendance";
import { attendanceEditDays, registerSectionIdsFor } from "@/lib/attendance-data";
import { formatDateOnly } from "@/lib/format";
import { requireModule } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { todayInTimeZone } from "@/lib/format";
import { toDateInput } from "@/lib/validation/common";
import { DatePicker } from "./date-picker";

const STATE_BADGE = { taken: "success", partial: "warning", notTaken: "outline", empty: "secondary" } as const;

export default async function AttendancePage({ searchParams }: { searchParams: { date?: string | string[] } }) {
  const ctx = await requireModule("attendance");
  const { user, db } = ctx;
  if (ctx.isPlatformAdmin) redirect("/dashboard");
  // Families see attendance on their child's profile.
  if (user.role === Role.PARENT || user.role === Role.STUDENT) redirect("/students");
  if (!can(user.role, "attendance", "read")) redirect("/dashboard");

  const t = await getTranslations("attendance");
  const settings = await getSettingsForUser(user.tenantId ?? null);
  const today = todayInTimeZone(settings.timezone);
  const date = parseDateParam(searchParams.date, today);
  const isAdmin = user.role === Role.SCHOOL_ADMIN;

  const year = await db.academicYear.findFirst({ where: { isActive: true } });
  if (!year) {
    return (
      <div>
        <PageHeader title={t("title")} />
        <EmptyState
          icon={<CalendarRange className="h-6 w-6" />}
          title={t("noYearTitle")}
          description={t("noYearDescription")}
          action={
            isAdmin ? (
              <Link href="/academics" className={buttonVariants()}>
                {t("goToYears")}
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  const allowed = await registerSectionIdsFor(ctx);
  const sections = await db.section.findMany({
    where: { class: { academicYearId: year.id }, ...(allowed === "all" ? {} : { id: { in: allowed } }) },
    orderBy: [{ class: { order: "asc" } }, { class: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      class: { select: { name: true } },
      formTeacher: { select: { user: { select: { name: true } } } },
      _count: { select: { students: { where: { status: "ACTIVE" } } } },
    },
  });
  const counts = await db.attendance.groupBy({
    by: ["sectionId", "status"],
    where: { date, sectionId: { in: sections.map((s) => s.id) }, student: { status: "ACTIVE" } },
    _count: { _all: true },
  });
  const bySection = new Map<string, { marked: number; absent: number }>();
  for (const c of counts) {
    if (!c.sectionId) continue;
    const entry = bySection.get(c.sectionId) ?? { marked: 0, absent: 0 };
    entry.marked += c._count._all;
    if (c.status === "ABSENT") entry.absent += c._count._all;
    bySection.set(c.sectionId, entry);
  }

  const editDays = await attendanceEditDays(db);
  const edit = canEditRegister({ date, today, isAdmin, editDays, year });
  const dateParam = toDateInput(date);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DatePicker value={dateParam} max={toDateInput(today)} min={toDateInput(year.startDate)} />
        <p className="text-sm text-muted-foreground">
          {isAdmin ? t("adminWindow") : t("teacherWindow", { days: editDays })}
        </p>
      </div>
      {!isSchoolDay(date) ? <p className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">{t("weekend")}</p> : null}
      {!edit.allowed ? <p className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">{t(`locked.${edit.reason}`)}</p> : null}

      {sections.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="h-6 w-6" />}
          title={isAdmin ? t("noSectionsAdmin") : t("noSectionsTeacher")}
          description={isAdmin ? t("noSectionsAdminHint") : t("noSectionsTeacherHint")}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => {
            const marked = bySection.get(s.id) ?? { marked: 0, absent: 0 };
            const state = registerState(s._count.students, marked.marked);
            const label = `${s.class.name} ${s.name}`;
            return (
              <Card key={s.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-medium">{label}</h2>
                      <p className="text-xs text-muted-foreground">
                        {s.formTeacher ? t("formTeacher", { name: s.formTeacher.user.name }) : t("noFormTeacher")}
                      </p>
                    </div>
                    <Badge variant={STATE_BADGE[state]}>{t(`state.${state}`)}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {state === "empty"
                      ? t("noStudents")
                      : t("markedCount", { marked: marked.marked, total: s._count.students, absent: marked.absent })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {state !== "empty" ? (
                      <Link
                        href={`/attendance/${s.id}?date=${dateParam}`}
                        className={buttonVariants({ size: "sm", variant: edit.allowed && state !== "taken" ? "default" : "outline" })}
                        aria-label={`${edit.allowed ? (state === "taken" ? t("edit") : t("take")) : t("view")}: ${label}`}
                      >
                        {edit.allowed ? (state === "taken" ? t("edit") : t("take")) : t("view")}
                      </Link>
                    ) : null}
                    <Link href={`/attendance/${s.id}/summary`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                      {t("termSummary")}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-6 text-xs text-muted-foreground">{t("dateShown", { date: formatDateOnly(date, settings) })}</p>
    </div>
  );
}
