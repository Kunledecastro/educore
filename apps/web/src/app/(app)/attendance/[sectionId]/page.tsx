import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Role } from "@educore/db";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { canEditRegister, isSchoolDay, parseDateParam } from "@/lib/attendance";
import { attendanceEditDays, loadRegisterSection, sectionStudents } from "@/lib/attendance-data";
import { formatDateOnly, formatDateTime, todayInTimeZone } from "@/lib/format";
import { requireModule } from "@/lib/guard";
import { NotFoundError } from "@/lib/run-action";
import { getSettingsForUser } from "@/lib/tenant";
import { toDateInput } from "@/lib/validation/common";
import { DatePicker } from "../date-picker";
import { RegisterForm } from "./register-form";

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: { sectionId: string };
  searchParams: { date?: string | string[] };
}) {
  const ctx = await requireModule("attendance");
  const { user, db } = ctx;
  if (ctx.isPlatformAdmin || !can(user.role, "attendance", "update")) redirect("/attendance");

  const section = await loadRegisterSection(ctx, params.sectionId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const [t, settings] = await Promise.all([getTranslations("attendance"), getSettingsForUser(user.tenantId ?? null)]);
  const year = section.class.academicYear;
  const today = todayInTimeZone(settings.timezone);
  const date = parseDateParam(searchParams.date, today);
  const isAdmin = user.role === Role.SCHOOL_ADMIN;
  const edit = year.isActive
    ? canEditRegister({ date, today, isAdmin, editDays: await attendanceEditDays(db), year })
    : ({ allowed: false, reason: "outsideYear" } as const);

  const students = await sectionStudents(db, section.id);
  const records = await db.attendance.findMany({
    where: { date, studentId: { in: students.map((s) => s.id) } },
    select: { studentId: true, status: true, remarks: true, updatedAt: true, markedBy: { select: { name: true } } },
  });
  const latest = records.reduce<(typeof records)[number] | null>((a, r) => (!a || r.updatedAt > a.updatedAt ? r : a), null);
  const label = `${section.class.name} ${section.name}`;

  return (
    <div>
      <Link href={`/attendance?date=${toDateInput(date)}`} className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-3 mb-2" })}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("backToAll")}
      </Link>
      <PageHeader
        title={t("registerTitle", { section: label })}
        description={section.formTeacher ? t("formTeacher", { name: section.formTeacher.user.name }) : t("noFormTeacher")}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DatePicker value={toDateInput(date)} max={toDateInput(today)} min={toDateInput(year.startDate)} />
        {latest ? (
          <p className="text-sm text-muted-foreground">
            {t("lastSaved", { name: latest.markedBy.name, when: formatDateTime(latest.updatedAt, settings) })}
          </p>
        ) : null}
      </div>
      {!isSchoolDay(date) ? <p className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">{t("weekend")}</p> : null}
      {!edit.allowed ? (
        <p role="status" className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">
          {t(`locked.${edit.reason}`)}
        </p>
      ) : null}

      {students.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title={t("noStudents")} description={t("noStudentsHint")} />
      ) : (
        <RegisterForm
          key={toDateInput(date)}
          sectionId={section.id}
          date={toDateInput(date)}
          dateLabel={formatDateOnly(date, settings)}
          readOnly={!edit.allowed}
          students={students.map((s) => {
            const r = records.find((x) => x.studentId === s.id);
            return {
              id: s.id,
              name: `${s.lastName}, ${s.firstName}`,
              admissionNo: s.admissionNo,
              status: r?.status ?? null,
              remark: r?.remarks ?? "",
            };
          })}
        />
      )}
    </div>
  );
}
