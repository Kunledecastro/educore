import Link from "next/link";
import { AlertTriangle, CalendarCheck, ClipboardList } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@educore/ui/button";
import { BarList, LineChart, Progress, StatTile } from "@/components/charts/charts";
import { formatDateOnly, formatMoney, formatNumber } from "@/lib/format";
import { percent } from "@/lib/charts";
import type { TenantSettings } from "@/lib/tenant-settings";
import { Empty, Panel, Row } from "./panel";
import { RemindButton } from "./remind-button";

/**
 * Role dashboards (Phase 9.1): each role opens on what it needs to act on.
 * Server components; the page loads the data (scoped to this school, and
 * for parents and teachers to their own children and classes).
 */

type S = Pick<TenantSettings, "locale" | "currency" | "timezone" | "dateStyle">;
const money = (minor: number, s: S) => formatMoney(minor / 100, s);
const weekLabel = (iso: string, s: S) => new Intl.DateTimeFormat(s.locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export interface AdminData {
  today: { pupils: number; here: number; absent: number; marked: number };
  registers: { total: number; missing: { sectionId: string; name: string; formTeacher: string | null; pupils: number; reminded: boolean }[] } | null;
  fees: { billed: number; paid: number; overdue: number; overdueFamilies: number } | null;
  trend: { week: string; rate: number }[];
  byClass: { key: string; name: string; billed: number; paid: number }[];
  approvals: { id: string; title: string; detail: string }[] | null;
  payments: { id: string; pupil: string; amountMinor: number; method: string; paidAt: Date }[] | null;
  canRemind: boolean;
}

function Tiles({ children }: { children: React.ReactNode }) {
  return <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</section>;
}

export async function AdminDashboard({ d, s }: { d: AdminData; s: S }) {
  const t = await getTranslations("dashboard.v2");
  const tm = await getTranslations("fees.invoice.methods");
  const num = (n: number) => formatNumber(n, s);
  const pct = d.today.pupils ? Math.round((d.today.here / d.today.pupils) * 1000) / 10 : null;
  return (
    <div className="space-y-6">
      <Tiles>
        <StatTile tone="warm" label={t("presentToday")} value={pct === null ? "—" : `${formatNumber(pct, s)}%`} detail={t("presentDetail", { here: num(d.today.here), pupils: num(d.today.pupils), absent: num(d.today.absent) })} />
        <StatTile
          label={t("registersTaken")}
          value={d.registers ? `${num(d.registers.total - d.registers.missing.length)} / ${num(d.registers.total)}` : "—"}
          detail={d.registers ? (d.registers.missing.length ? <span className="font-semibold text-primary">{t("registersMissing", { count: d.registers.missing.length })}</span> : t("registersAllDone")) : t("noSchoolToday")}
        />
        {d.fees ? (
          <StatTile label={t("feesCollected")} value={money(d.fees.paid, s)} detail={t("feesOfBilled", { pct: percent(d.fees.paid, d.fees.billed), billed: money(d.fees.billed, s) })}>
            <Progress value={d.fees.paid} total={d.fees.billed} label={t("feesCollected")} className="mt-1" />
          </StatTile>
        ) : (
          <StatTile label={t("feesCollected")} value="—" detail={t("notBilledYet")} />
        )}
        <StatTile
          tone="dark"
          label={t("overdue")}
          value={d.fees ? money(d.fees.overdue, s) : "—"}
          detail={
            d.fees && d.fees.overdueFamilies ? (
              <>
                {t("overdueFamilies", { count: d.fees.overdueFamilies })} ·{" "}
                <Link href="/fees?status=OVERDUE" className="font-semibold underline underline-offset-2">
                  {t("seeOverdue")}
                </Link>
              </>
            ) : (
              t("nothingOverdue")
            )
          }
        />
      </Tiles>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("attendanceTrend")} href="/attendance" linkLabel={t("openAttendance")}>
          {d.trend.length >= 2 ? (
            <LineChart values={d.trend.map((w) => w.rate)} labels={d.trend.map((w) => weekLabel(w.week, s))} formatTick={(n) => `${n}%`} label={t("attendanceTrendLabel", { first: `${d.trend[0]!.rate}%`, last: `${d.trend[d.trend.length - 1]!.rate}%`, weeks: d.trend.length })} />
          ) : (
            <Empty>{t("trendNotYet")}</Empty>
          )}
        </Panel>
        <Panel title={t("feesByClass")} href="/fees/reports" linkLabel={t("openFeeReports")}>
          {d.byClass.length ? (
            <BarList label={t("feesByClass")} doneLabel={t("collected")} restLabel={t("stillOwed")} rows={d.byClass.map((r) => ({ key: r.key, name: r.name, done: r.paid, total: r.billed, valueText: `${percent(r.paid, r.billed)}%` }))} />
          ) : (
            <Empty>{t("notBilledYet")}</Empty>
          )}
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title={t("registersNotTaken")} href="/attendance" linkLabel={t("openAttendance")}>
          {!d.registers ? (
            <Empty>{t("noSchoolToday")}</Empty>
          ) : d.registers.missing.length === 0 ? (
            <Empty>{t("registersAllDone")}</Empty>
          ) : (
            <ul>
              {d.registers.missing.slice(0, 6).map((r) => (
                <Row key={r.sectionId} title={r.name} detail={`${r.formTeacher ?? t("noFormTeacher")} · ${t("pupils", { count: r.pupils })}`} right={d.canRemind && r.formTeacher ? <RemindButton sectionId={r.sectionId} className={r.name} reminded={r.reminded} /> : null} />
              ))}
            </ul>
          )}
        </Panel>
        {d.approvals ? (
          <Panel title={t("waitingApproval")} href="/approvals" linkLabel={t("openApprovals")}>
            {d.approvals.length === 0 ? (
              <Empty>{t("nothingWaiting")}</Empty>
            ) : (
              <ul>
                {d.approvals.map((a) => (
                  <Row key={a.id} title={a.title} detail={a.detail} right={<Link href={`/approvals/${a.id}`} className={buttonVariants({ size: "sm" })}>{t("review")}</Link>} />
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
        {d.payments ? (
          <Panel title={t("latestPayments")} href="/payments" linkLabel={t("openPayments")}>
            {d.payments.length === 0 ? (
              <Empty>{t("noPayments")}</Empty>
            ) : (
              <ul>
                {d.payments.map((p) => (
                  <Row key={p.id} title={p.pupil} detail={`${tm(p.method as never)} · ${formatDateOnly(p.paidAt, s)}`} right={<span className="text-sm font-bold tabular-nums">{money(p.amountMinor, s)}</span>} />
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </section>
    </div>
  );
}

export interface BursarData {
  fees: { billed: number; paid: number; outstanding: number; overdue: number; overdueFamilies: number } | null;
  collectedToday: number;
  byClass: { key: string; name: string; billed: number; paid: number }[];
  debtors: { studentId: string; name: string; admissionNo: string; className: string | null; owed: number; overdue: boolean }[];
  payments: { id: string; pupil: string; amountMinor: number; method: string; paidAt: Date }[];
  approvals: { id: string; title: string; detail: string }[] | null;
}

export async function BursarDashboard({ d, s }: { d: BursarData; s: S }) {
  const t = await getTranslations("dashboard.v2");
  const tm = await getTranslations("fees.invoice.methods");
  return (
    <div className="space-y-6">
      <Tiles>
        <StatTile tone="warm" label={t("collectedToday")} value={money(d.collectedToday, s)} />
        {d.fees ? (
          <StatTile label={t("feesCollected")} value={money(d.fees.paid, s)} detail={t("feesOfBilled", { pct: percent(d.fees.paid, d.fees.billed), billed: money(d.fees.billed, s) })}>
            <Progress value={d.fees.paid} total={d.fees.billed} label={t("feesCollected")} className="mt-1" />
          </StatTile>
        ) : (
          <StatTile label={t("feesCollected")} value="—" detail={t("notBilledYet")} />
        )}
        <StatTile label={t("outstanding")} value={d.fees ? money(d.fees.outstanding, s) : "—"} />
        <StatTile tone="dark" label={t("overdue")} value={d.fees ? money(d.fees.overdue, s) : "—"} detail={d.fees?.overdueFamilies ? t("overdueFamilies", { count: d.fees.overdueFamilies }) : t("nothingOverdue")} />
      </Tiles>
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("feesByClass")} href="/fees/reports" linkLabel={t("openFeeReports")}>
          {d.byClass.length ? (
            <BarList label={t("feesByClass")} doneLabel={t("collected")} restLabel={t("stillOwed")} rows={d.byClass.map((r) => ({ key: r.key, name: r.name, done: r.paid, total: r.billed, valueText: `${money(r.paid, s)} / ${money(r.billed, s)}` }))} />
          ) : (
            <Empty>{t("notBilledYet")}</Empty>
          )}
        </Panel>
        <Panel title={t("largestBalances")} href="/fees?status=OVERDUE" linkLabel={t("seeOverdue")}>
          {d.debtors.length === 0 ? (
            <Empty>{t("nothingOwed")}</Empty>
          ) : (
            <ul>
              {d.debtors.map((x) => (
                <Row
                  key={x.studentId}
                  title={<Link href={`/students/${x.studentId}`} className="hover:underline">{x.name}</Link>}
                  detail={[x.className, x.admissionNo, x.overdue ? t("overdueTag") : null].filter(Boolean).join(" · ")}
                  right={<span className="text-sm font-bold tabular-nums">{money(x.owed, s)}</span>}
                />
              ))}
            </ul>
          )}
        </Panel>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("latestPayments")} href="/payments" linkLabel={t("openPayments")}>
          {d.payments.length === 0 ? (
            <Empty>{t("noPayments")}</Empty>
          ) : (
            <ul>
              {d.payments.map((p) => (
                <Row key={p.id} title={p.pupil} detail={`${tm(p.method as never)} · ${formatDateOnly(p.paidAt, s)}`} right={<span className="text-sm font-bold tabular-nums">{money(p.amountMinor, s)}</span>} />
              ))}
            </ul>
          )}
        </Panel>
        {d.approvals ? (
          <Panel title={t("waitingApproval")} href="/approvals" linkLabel={t("openApprovals")}>
            {d.approvals.length === 0 ? (
              <Empty>{t("nothingWaiting")}</Empty>
            ) : (
              <ul>
                {d.approvals.map((a) => (
                  <Row key={a.id} title={a.title} detail={a.detail} right={<Link href={`/approvals/${a.id}`} className={buttonVariants({ size: "sm" })}>{t("review")}</Link>} />
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </section>
    </div>
  );
}

export interface TeacherData {
  lessons: { id: string; time: string; className: string; subject: string; room: string | null; sectionId: string; subjectId: string; registerTaken: boolean }[];
  reminders: { sectionId: string; name: string }[];
  formRegisters: { total: number; missing: { sectionId: string; name: string }[] } | null;
  unread: number | null;
  toMark: number | null;
  termId: string | null;
}

export async function TeacherDashboard({ d, todayIso }: { d: TeacherData; todayIso: string }) {
  const t = await getTranslations("dashboard.v2");
  return (
    <div className="space-y-6">
      {d.reminders.map((r) => (
        <p key={r.sectionId} role="status" className="flex items-center gap-3 rounded-2xl border border-warning bg-accent p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="flex-1">{t("reminderFromOffice", { name: r.name })}</span>
          <Link href={`/attendance/${r.sectionId}?date=${todayIso}`} className={buttonVariants({ size: "sm" })}>
            {t("takeRegister")}
          </Link>
        </p>
      ))}
      <Tiles>
        <StatTile tone="warm" label={t("lessonsToday")} value={d.lessons.length} detail={d.lessons[0] ? t("firstLesson", { time: d.lessons[0].time.split("–")[0]!, name: d.lessons[0].className }) : t("noLessonsToday")} />
        <StatTile label={t("myRegisters")} value={d.formRegisters ? `${d.formRegisters.total - d.formRegisters.missing.length} / ${d.formRegisters.total}` : "—"} detail={d.formRegisters ? (d.formRegisters.missing.length ? <span className="font-semibold text-primary">{t("registersMissing", { count: d.formRegisters.missing.length })}</span> : t("registersAllDone")) : t("noSchoolToday")} />
        {d.toMark !== null ? <StatTile label={t("toMark")} value={d.toMark} detail={<Link href="/assignments" className="underline underline-offset-2">{t("openAssignments")}</Link>} /> : null}
        {d.unread !== null ? <StatTile tone="dark" label={t("unreadMessages")} value={d.unread} detail={<Link href="/messages" className="underline underline-offset-2">{t("openMessages")}</Link>} /> : null}
      </Tiles>
      <Panel title={t("todaysLessons")} href="/timetable" linkLabel={t("openTimetable")}>
        {d.lessons.length === 0 ? (
          <Empty>{t("noLessonsToday")}</Empty>
        ) : (
          <ol>
            {d.lessons.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0 first:pt-0">
                <span className="w-24 shrink-0 text-sm font-bold tabular-nums">{l.time}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{l.subject} · {l.className}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[l.room, l.registerTaken ? t("registerTaken") : t("registerNotTaken")].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Link href={`/attendance/${l.sectionId}?date=${todayIso}`} className={buttonVariants({ size: "sm", variant: l.registerTaken ? "outline" : "default" })}>
                    <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                    {t("register")}
                  </Link>
                  {d.termId ? (
                    <Link href={`/assessments/${l.sectionId}/${l.subjectId}?term=${d.termId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                      <ClipboardList className="h-4 w-4" aria-hidden="true" />
                      {t("marks")}
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

export interface ParentChild {
  id: string;
  name: string;
  firstName: string;
  className: string | null;
  formTeacher: string | null;
  attendanceRate: number | null;
  absences: number;
  owedMinor: number;
  nextDue: Date | null;
  result: { termName: string; average: number; position: number | null; positionOutOf: number } | null;
}

export async function ParentDashboard({ kids: children, s, unread, canPay }: { kids: ParentChild[]; s: S; unread: number | null; canPay: boolean }) {
  const t = await getTranslations("dashboard.v2");
  if (children.length === 0) return <Empty>{t("noChildren")}</Empty>;
  const totalOwed = children.reduce((n, c) => n + c.owedMinor, 0);
  const nextDue = children.map((c) => c.nextDue).filter((x): x is Date => Boolean(x)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  return (
    <div className="space-y-5">
      <section aria-label={t("yourChildren")} className="grid gap-4 md:grid-cols-2">
        {children.map((c) => (
          <article key={c.id} className="flex flex-col gap-4 rounded-3xl bg-harmattan p-5 text-foreground">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-base font-extrabold text-primary">
                {c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}
              </span>
              <span className="min-w-0">
                <Link href={`/students/${c.id}`} className="block truncate text-lg font-extrabold tracking-tight hover:underline">
                  {c.name}
                </Link>
                <span className="block truncate text-sm text-foreground/80">{[c.className, c.formTeacher ? t("formTeacher", { name: c.formTeacher }) : null].filter(Boolean).join(" · ")}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-card/80 p-3">
                <span className="block text-xs text-foreground/80">{t("attendanceThisTerm")}</span>
                <b className="text-2xl font-extrabold tracking-tight">{c.attendanceRate === null ? "—" : `${c.attendanceRate}%`}</b>
                <span className="block text-xs text-foreground/80">{t("daysAbsent", { count: c.absences })}</span>
              </div>
              <div className="rounded-2xl bg-card/80 p-3">
                <span className="block text-xs text-foreground/80">{c.result ? t("latestResult", { term: c.result.termName }) : t("results")}</span>
                <b className="text-2xl font-extrabold tracking-tight">{c.result ? formatNumber(c.result.average, s) : "—"}</b>
                <span className="block text-xs text-foreground/80">
                  {c.result ? (c.result.position ? t("position", { position: c.result.position, of: c.result.positionOutOf }) : t("average")) : t("notPublishedYet")}
                </span>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="pd-fees" className="flex flex-col gap-3 rounded-3xl bg-ink p-5 text-ink-foreground">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pd-fees" className="text-sm font-semibold opacity-80">
            {t("feesToPay")}
          </h2>
          {nextDue && totalOwed > 0 ? <span className="text-xs font-bold text-warning">{t("dueBy", { date: formatDateOnly(nextDue, s) })}</span> : null}
        </div>
        <b className="text-3xl font-extrabold tracking-tight">{money(totalOwed, s)}</b>
        {children.length > 1 && totalOwed > 0 ? (
          <ul className="text-sm opacity-80">
            {children.filter((c) => c.owedMinor > 0).map((c) => (
              <li key={c.id}>{t("childOwes", { name: c.firstName, amount: money(c.owedMinor, s) })}</li>
            ))}
          </ul>
        ) : null}
        {totalOwed > 0 ? (
          <Link href="/fees" className="flex min-h-12 items-center justify-center rounded-full bg-warning px-5 text-base font-bold text-warning-foreground hover:opacity-90">
            {canPay ? t("payNow") : t("seeFees")}
          </Link>
        ) : (
          <p className="text-sm opacity-80">{t("allPaid")}</p>
        )}
      </section>

      {unread ? (
        <Link href="/messages" className="flex items-center justify-between rounded-2xl border bg-card p-4 text-sm font-semibold hover:bg-accent">
          {t("unreadFromSchool", { count: unread })}
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </div>
  );
}

export async function StudentDashboard({ lessons, results }: { lessons: { id: string; time: string; subject: string; teacher: string | null; room: string | null }[]; results: number }) {
  const t = await getTranslations("dashboard.v2");
  return (
    <div className="space-y-6">
      <Panel title={t("myDay")} href="/timetable" linkLabel={t("openTimetable")}>
        {lessons.length === 0 ? (
          <Empty>{t("noLessonsToday")}</Empty>
        ) : (
          <ol>
            {lessons.map((l) => (
              <Row key={l.id} title={`${l.time} · ${l.subject}`} detail={[l.teacher, l.room].filter(Boolean).join(" · ")} />
            ))}
          </ol>
        )}
      </Panel>
      <Link href="/assessments/mine" className="flex items-center justify-between rounded-2xl border bg-card p-4 text-sm font-semibold hover:bg-accent">
        {t("myResults", { count: results })}
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
