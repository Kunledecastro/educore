import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { can } from "@educore/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { requireUser } from "@/lib/guard";
import { getSettingsForUser, getTenantForUser } from "@/lib/tenant";
import { formatMoney, formatNumber, todayInTimeZone } from "@/lib/format";
import { loadOnboardingChecklist } from "@/lib/onboarding-data";
import { getCurrentTerm } from "@/lib/current-term";
import { isSchoolDay } from "@/lib/attendance";
import { incompleteRegisters } from "@/lib/attendance-data";
import { teacherSectionIds } from "@/lib/teacher-sections";
import type { OnboardingChecklist as Checklist } from "@/lib/onboarding";
import { OnboardingChecklist, OnboardingReminder } from "@/components/dashboard/onboarding-checklist";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const { user, db } = await requireUser();
  const t = await getTranslations("dashboard");
  const settings = await getSettingsForUser(user.tenantId ?? null);
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, settings);
  const num = (v: number) => formatNumber(v, settings);

  let stats: { label: string; value: string | number }[] = [];
  const { year, term } = user.tenantId ? await getCurrentTerm(db, settings.timezone) : { year: null, term: null };

  // Setup checklist (milestone 1.4): school admins only. Shown until they hide
  // it; once hidden, a slim reminder stays while setup is unfinished.
  let onboarding: { checklist: Checklist; hidden: boolean } | null = null;
  if (user.tenantId && can(user.role, "onboarding", "read")) {
    const [checklist, { tenant }] = await Promise.all([loadOnboardingChecklist(db, user.id), getTenantForUser(user.tenantId)]);
    onboarding = { checklist, hidden: Boolean(tenant?.onboardingDismissedAt) };
  }

  switch (user.role) {
    case Role.PLATFORM_ADMIN: {
      const [tenantCount, activeSubs] = await Promise.all([
        db.tenant.count(),
        db.subscription.count({ where: { status: "ACTIVE" } }),
      ]);
      stats = [
        { label: t("platformSchools"), value: num(tenantCount) },
        { label: t("platformActiveSubscriptions"), value: num(activeSubs) },
      ];
      break;
    }
    case Role.SCHOOL_ADMIN: {
      const today = todayInTimeZone(settings.timezone);
      const [studentCount, presentToday, feeAgg, registers] = await Promise.all([
        db.student.count({ where: { status: "ACTIVE" } }),
        db.attendance.count({ where: { date: today, status: { in: ["PRESENT", "LATE"] } } }),
        db.payment.aggregate({ _sum: { amount: true } }),
        isSchoolDay(today) ? incompleteRegisters(db, today, "all") : Promise.resolve(null),
      ]);
      stats = [
        { label: t("enrollment"), value: num(studentCount) },
        { label: t("attendanceToday"), value: num(presentToday) },
        {
          label: t("registersNotTaken"),
          value: registers ? t("registersValue", { incomplete: registers.incomplete, total: registers.total }) : t("noSchoolToday"),
        },
        { label: t("feeCollection"), value: money(feeAgg._sum.amount) },
      ];
      break;
    }
    case Role.ACCOUNTANT: {
      const [outstanding, collected] = await Promise.all([
        db.invoice.aggregate({ _sum: { totalDue: true }, where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } } }),
        db.payment.aggregate({ _sum: { amount: true } }),
      ]);
      stats = [
        { label: t("outstandingFees"), value: money(outstanding._sum.totalDue) },
        { label: t("feeCollection"), value: money(collected._sum.amount) },
      ];
      break;
    }
    case Role.TEACHER: {
      const todayDate = todayInTimeZone(settings.timezone);
      const { teacherId, formSectionIds } = await teacherSectionIds(db, user.id);
      const classesToday = teacherId
        ? await db.timetableEntry.count({ where: { teacherId, dayOfWeek: todayDate.getUTCDay() } })
        : 0;
      // Registers are the form teacher's job (decision 4); count only their sections.
      const pending = isSchoolDay(todayDate) ? await incompleteRegisters(db, todayDate, formSectionIds) : null;
      stats = [
        { label: t("todaysClasses"), value: classesToday },
        { label: t("pendingAttendance"), value: pending ? pending.incomplete : t("noSchoolToday") },
        { label: t("unreadMessages"), value: 0 },
      ];
      break;
    }
    case Role.PARENT: {
      const guardian = await db.guardian.findUnique({
        where: { userId: user.id },
        include: { students: { include: { student: true } } },
      });
      const childCount = guardian?.students.length ?? 0;
      const studentIds = guardian?.students.map((s) => s.studentId) ?? [];
      const feesDue = studentIds.length
        ? await db.invoice.aggregate({ _sum: { totalDue: true }, where: { studentId: { in: studentIds } } })
        : { _sum: { totalDue: null } };
      stats = [
        { label: t("childrenOverview"), value: childCount },
        { label: t("feesDue"), value: money(feesDue._sum.totalDue) },
      ];
      break;
    }
    case Role.STUDENT: {
      const student = await db.student.findUnique({ where: { userId: user.id } });
      const resultsCount = student ? await db.mark.count({ where: { studentId: student.id } }) : 0;
      stats = [{ label: t("results"), value: resultsCount }];
      break;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("welcome", { name: user.name })}</h1>
        {year ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {term ? t("yearAndTerm", { year: year.name, term: term.name }) : t("yearOnly", { year: year.name })}
          </p>
        ) : null}
      </div>
      {onboarding && !onboarding.hidden ? <OnboardingChecklist checklist={onboarding.checklist} /> : null}
      {onboarding && onboarding.hidden && !onboarding.checklist.complete ? (
        <OnboardingReminder checklist={onboarding.checklist} />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} />
        ))}
      </div>
    </div>
  );
}
