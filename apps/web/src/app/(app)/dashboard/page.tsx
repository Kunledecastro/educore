import { getTranslations } from "next-intl/server";
import { AdminDashboard, BursarDashboard, ParentDashboard, StudentDashboard, TeacherDashboard, type AdminData, type BursarData, type ParentChild, type TeacherData } from "@/components/dashboard/role-dashboards";
import { attendanceToday, attendanceTrend, collectedSince, debtors, feesByClass, latestPayments, latestPublishedResult, parentChildren, registersNotTaken, remindersFor, teacherToday } from "@/lib/dashboard/data";
import { headline } from "@/lib/approvals/describe";
import { listRequests } from "@/lib/approvals/engine";
import { getEffectiveSession } from "@/lib/session";
import { Role } from "@educore/db";
import { can } from "@educore/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { requireUser } from "@/lib/guard";
import { getSettingsForUser, getTenantForUser } from "@/lib/tenant";
import { formatMoney, formatNumber, todayInTimeZone } from "@/lib/format";
import { loadOnboardingChecklist } from "@/lib/onboarding-data";
import { sampleDataStatus } from "@/lib/sample-data";
import { SampleDataCard } from "@/components/dashboard/sample-data-card";
import { getCurrentTerm } from "@/lib/current-term";
import { isSchoolDay } from "@/lib/attendance";
import { teacherSectionIds } from "@/lib/teacher-sections";
import { feeTotals } from "@/lib/fee-summary";
import type { OnboardingChecklist as Checklist } from "@/lib/onboarding";
import { greeting } from "@/components/layout/top-bar";
import { OnboardingChecklist, OnboardingReminder } from "@/components/dashboard/onboarding-checklist";
import { AnnouncementsCard } from "@/components/messaging/announcements-card";
import { AssignmentsDueCard } from "@/components/assignments/due-card";
import { assignmentViewer } from "@/lib/assignments/data";
import type { AnyRole } from "@/lib/assignments/rules";
import { getEntitlements } from "@/lib/entitlements-server";
import { unreadThreadCount, viewerFor } from "@/lib/messaging/data";
import type { MessagingRole } from "@/lib/messaging/rules";
import Link from "next/link";
import { alertCounts } from "@/lib/health/alerts";
import { countProfilesToCheck, healthConfigured, healthViewer } from "@/lib/health/data";
import { listVisits, type VisitRow } from "@/lib/health/visits";
import { nowLocal, visitFmt } from "@/lib/health/visit-format";
import { zonedLocalToUtc } from "@/lib/zoned-time";
import { VisitList } from "@/components/health/visit-list";
import { waitingCount } from "@/lib/approvals/engine";

/** The first few requests waiting for this person's decision (admin and bursar dashboards). */
async function waitingList(tenantId: string, userId: string, role: string, on: boolean) {
  if (!on) return null;
  const t = await getTranslations("approvals");
  const { rows } = await listRequests({ tenantId, userId, role, impersonating: false }, { tab: "waiting", take: 3 }).catch(() => ({ rows: [] }));
  return rows.map((r) => ({ id: r.id, title: headline(t as never, r.process, r.summary), detail: `${t(`process.${r.process}`)} · ${r.requestedBy}` }));
}

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
  // Phase 9.1: role dashboards that show what to act on.
  let admin: AdminData | null = null;
  let bursar: BursarData | null = null;
  let teacher: TeacherData | null = null;
  let parent: ParentChild[] | null = null;
  let pupil: { results: number; lessons: { id: string; time: string; subject: string; teacher: string | null; room: string | null }[] } | null = null;
  const impersonating = Boolean((await getEffectiveSession())?.impersonation);
  const { year, term } = user.tenantId ? await getCurrentTerm(db, settings.timezone) : { year: null, term: null };

  // Setup checklist (milestone 1.4): school admins only. Shown until they hide
  // it; once hidden, a slim reminder stays while setup is unfinished.
  let onboarding: { checklist: Checklist; hidden: boolean } | null = null;
  let sample: Awaited<ReturnType<typeof sampleDataStatus>> | null = null;
  if (user.tenantId && can(user.role, "onboarding", "read")) {
    const [checklist, { tenant }, sampleStatus] = await Promise.all([loadOnboardingChecklist(db, user.id), getTenantForUser(user.tenantId), sampleDataStatus(user.tenantId)]);
    onboarding = { checklist, hidden: Boolean(tenant?.onboardingDismissedAt) };
    sample = sampleStatus;
  }

  // Announcements and unread messages (4.4), when the school's plan includes messaging.
  const messaging = user.tenantId ? (await getEntitlements(user.tenantId)).modules.has("messaging") : false;
  const viewer = messaging && user.tenantId ? await viewerFor(user.tenantId, { id: user.id, role: user.role as MessagingRole }) : null;
  const unread = viewer && can(user.role, "message", "read") ? await unreadThreadCount(user.tenantId!, user.id) : null;

  // Work still to do (5.1), for students and parents when the plan includes assignments.
  const family = user.role === Role.STUDENT || user.role === Role.PARENT;
  const homework = family && user.tenantId && (await getEntitlements(user.tenantId)).modules.has("assignments") ? await assignmentViewer(user.tenantId, { id: user.id, role: user.role as AnyRole }) : null;

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
      const ent = await getEntitlements(user.tenantId!);
      const feesOn = ent.modules.has("fees");
      const [att, registers, fees, trend, byClass, owing, payments, approvals] = await Promise.all([
        attendanceToday(db, today),
        isSchoolDay(today) ? registersNotTaken(db, today) : Promise.resolve(null),
        feesOn && term ? feeTotals(db, { termId: term.id }, today) : Promise.resolve(null),
        attendanceTrend(db, today, { from: term?.startDate }),
        feesOn && term ? feesByClass(db, term.id) : Promise.resolve([]),
        feesOn ? debtors(db, today, 0) : Promise.resolve(null),
        feesOn ? latestPayments(db, 5) : Promise.resolve(null),
        waitingList(user.tenantId!, user.id, user.role, ent.modules.has("approvals")),
      ]);
      admin = {
        today: att,
        registers,
        fees: fees && fees.count ? { billed: fees.billed, paid: fees.paid, overdue: fees.overdue, overdueFamilies: owing?.overdueFamilies ?? 0 } : null,
        trend,
        byClass,
        approvals,
        payments,
        canRemind: !impersonating,
      };
      break;
    }
    case Role.ACCOUNTANT: {
      const today = todayInTimeZone(settings.timezone);
      const ent = await getEntitlements(user.tenantId!);
      const [fees, collected, byClass, owing, payments, approvals] = await Promise.all([
        term ? feeTotals(db, { termId: term.id }, today) : Promise.resolve(null),
        collectedSince(db, today),
        term ? feesByClass(db, term.id) : Promise.resolve([]),
        debtors(db, today, 5),
        latestPayments(db, 5),
        waitingList(user.tenantId!, user.id, user.role, ent.modules.has("approvals")),
      ]);
      bursar = {
        fees: fees && fees.count ? { billed: fees.billed, paid: fees.paid, outstanding: fees.outstanding, overdue: fees.overdue, overdueFamilies: owing.overdueFamilies } : null,
        collectedToday: collected,
        byClass,
        debtors: owing.top,
        payments,
        approvals,
      };
      break;
    }
    case Role.TEACHER: {
      const todayDate = todayInTimeZone(settings.timezone);
      const { teacherId, formSectionIds } = await teacherSectionIds(db, user.id);
      const assignmentsOn = (await getEntitlements(user.tenantId!)).modules.has("assignments");
      const [lessons, reminders, formRegisters, toMark] = await Promise.all([
        teacherId ? teacherToday(db, teacherId, todayDate) : Promise.resolve([]),
        isSchoolDay(todayDate) ? remindersFor(db, formSectionIds, todayDate) : Promise.resolve([]),
        isSchoolDay(todayDate) && formSectionIds.length ? registersNotTaken(db, todayDate, formSectionIds) : Promise.resolve(null),
        assignmentsOn ? db.assignmentSubmission.count({ where: { status: "SUBMITTED", assignment: { createdById: user.id } } }) : Promise.resolve(null),
      ]);
      teacher = {
        lessons,
        reminders,
        formRegisters: formRegisters ? { total: formRegisters.total, missing: formRegisters.missing.map((x) => ({ sectionId: x.sectionId, name: x.name })) } : null,
        unread,
        toMark,
        termId: term?.id ?? null,
      };
      break;
    }
    case Role.PARENT: {
      const today = todayInTimeZone(settings.timezone);
      const [kids, options] = await Promise.all([parentChildren(db, user.id, term, today), db.academicSettings.findFirst({ select: { showPosition: true } })]);
      const results = await Promise.all(kids.map((k) => latestPublishedResult(db, k)));
      parent = kids.map((k, i) => {
        const r = results[i] ?? null;
        return { ...k, result: r ? { ...r, position: options?.showPosition ? r.position : null } : null };
      });
      break;
    }
    case Role.STUDENT: {
      const student = await db.student.findUnique({ where: { userId: user.id } });
      const resultsCount = student ? await db.mark.count({ where: { studentId: student.id } }) : 0;
      const today = todayInTimeZone(settings.timezone);
      const lessons = student?.sectionId
        ? await db.timetableEntry.findMany({
            where: { sectionId: student.sectionId, dayOfWeek: today.getUTCDay(), academicYear: { isActive: true } },
            orderBy: [{ startTime: "asc" }, { period: "asc" }],
            select: { id: true, startTime: true, endTime: true, room: true, subject: { select: { name: true } }, teacher: { select: { user: { select: { name: true } } } } },
          })
        : [];
      pupil = { results: resultsCount, lessons: lessons.map((l) => ({ id: l.id, time: `${l.startTime}–${l.endTime}`, subject: l.subject.name, teacher: l.teacher.user.name, room: l.room })) };
      break;
    }
  }

  // Health alerts (7.1): teachers for their classes, the nurse for the school.
  // Clinic visits (7.2): parents see their children's last 7 days (urgent first);
  // teachers see who from their classes was in the clinic today (when and the
  // outcome only); the nurse sees today's count.
  let health: { pupils: number; severe: number; toCheck: number | null } | null = null;
  let visits: { title: string; rows: VisitRow[]; showPupil: boolean } | null = null;
  const healthOn = Boolean(user.tenantId) && healthConfigured() && user.tenantId ? (await getEntitlements(user.tenantId)).modules.has("health") : false;
  if (healthOn && user.tenantId && (user.role === Role.TEACHER || user.role === Role.SCHOOL_NURSE || user.role === Role.PARENT)) {
    try {
      const hv = await healthViewer(user.tenantId, { id: user.id, role: user.role });
      if (user.role !== Role.PARENT) {
        const counts = await alertCounts(hv);
        const toCheck = user.role === Role.SCHOOL_NURSE ? await countProfilesToCheck(user.tenantId) : null;
        health = { ...counts, toCheck };
      }
      const startOfToday = zonedLocalToUtc(`${nowLocal(settings.timezone).slice(0, 10)}T00:00`, settings.timezone) ?? new Date(Date.now() - 86_400_000);
      if (user.role === Role.PARENT) {
        const rows = await listVisits(hv, { from: new Date(Date.now() - 7 * 86_400_000), take: 10 });
        if (rows.length) visits = { title: t("clinicVisitsRecent"), rows: [...rows].sort((a, b) => Number(b.urgent) - Number(a.urgent)), showPupil: true };
      } else {
        const rows = await listVisits(hv, { from: startOfToday, take: 50 });
        if (rows.length || user.role === Role.SCHOOL_NURSE) visits = { title: t("clinicVisitsToday", { count: rows.length }), rows: user.role === Role.SCHOOL_NURSE ? rows.slice(0, 5) : rows, showPupil: true };
      }
    } catch (err) {
      console.error("[dashboard] health summary unavailable", err);
    }
  }

  // Approvals (8.0): requests waiting for this person's decision.
  let approvalsWaiting: number | null = null;
  if (user.tenantId && (user.role === Role.SCHOOL_ADMIN || user.role === Role.ACCOUNTANT) && (await getEntitlements(user.tenantId)).modules.has("approvals")) {
    approvalsWaiting = await waitingCount({ tenantId: user.tenantId, userId: user.id, role: user.role, impersonating: false }).catch(() => null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{settings ? await greeting(user.name, settings.timezone) : t("welcome", { name: user.name })}</h1>
        {year ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {term ? t("yearAndTerm", { year: year.name, term: term.name }) : t("yearOnly", { year: year.name })}
          </p>
        ) : null}
      </div>
      {sample && (sample.loaded || sample.canLoad) ? <SampleDataCard loaded={sample.loaded} pupils={sample.pupils} /> : null}
      {onboarding && !onboarding.hidden ? <OnboardingChecklist checklist={onboarding.checklist} /> : null}
      {onboarding && onboarding.hidden && !onboarding.checklist.complete ? (
        <OnboardingReminder checklist={onboarding.checklist} />
      ) : null}
      {admin ? <AdminDashboard d={admin} s={settings} /> : null}
      {bursar ? <BursarDashboard d={bursar} s={settings} /> : null}
      {teacher ? <TeacherDashboard d={teacher} todayIso={todayInTimeZone(settings.timezone).toISOString().slice(0, 10)} /> : null}
      {parent ? <ParentDashboard kids={parent} s={settings} unread={unread} canPay={user.tenantId ? (await getEntitlements(user.tenantId)).modules.has("onlinePayments") : false} /> : null}
      {pupil ? <StudentDashboard lessons={pupil.lessons} results={pupil.results} /> : null}
      {stats.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
      ) : null}
      {health ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>{t("healthAlerts")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {t("healthAlertsCount", { count: health.pupils })}
              {health.severe ? <span className="font-semibold text-destructive"> · {t("healthAlertsSevere", { count: health.severe })}</span> : null}
            </p>
            {health.toCheck !== null ? <p>{t("healthToCheck", { count: health.toCheck })}</p> : null}
            <Link href="/health-alerts" className="inline-block underline underline-offset-2">
              {t("healthAlertsLink")}
            </Link>
          </CardContent>
        </Card>
      ) : null}
      {approvalsWaiting && !admin && !bursar ? (
        <Card className="border-warning">
          <CardHeader className="pb-2">
            <CardTitle>{t("approvalsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{t("approvalsWaiting", { count: approvalsWaiting })}</p>
            <Link href="/approvals" className="inline-block underline underline-offset-2">
              {t("approvalsLink")}
            </Link>
          </CardContent>
        </Card>
      ) : null}
      {visits ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>{visits.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <VisitList visits={visits.rows} fmt={visitFmt(settings)} showPupil={visits.showPupil} empty={t("clinicVisitsNone")} />
            <Link href={user.role === Role.PARENT ? "/health" : user.role === Role.SCHOOL_NURSE ? "/clinic/visits" : "/health-alerts"} className="inline-block text-sm underline underline-offset-2">
              {user.role === Role.PARENT ? t("clinicVisitsParentLink") : user.role === Role.SCHOOL_NURSE ? t("clinicVisitsNurseLink") : t("healthAlertsLink")}
            </Link>
          </CardContent>
        </Card>
      ) : null}
      {homework ? <AssignmentsDueCard viewer={homework} settings={settings} /> : null}
      {viewer ? <AnnouncementsCard viewer={viewer} settings={settings} /> : null}
    </div>
  );
}
