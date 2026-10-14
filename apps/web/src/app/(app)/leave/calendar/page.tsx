import Link from "next/link";
import { CalendarOff, ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { formatDateOnly, todayInTimeZone } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { leaveCalendar } from "@/lib/leave/data";
import { day, iso, monthDays } from "@/lib/leave/rules";
import { getSettingsForUser } from "@/lib/tenant";
import { CancelLeaveButton } from "../leave-forms";

export const dynamic = "force-dynamic";

/** Admins (Phase 8.2): who is away, or asking to be, in a month. */
export default async function LeaveCalendarPage({ searchParams }: { searchParams: { month?: string | string[] } }) {
  const { user } = await requirePermission("leave", "update", { page: true });
  const tenantId = user.tenantId!;
  const settings = await getSettingsForUser(tenantId);
  const raw = Array.isArray(searchParams.month) ? searchParams.month[0] : searchParams.month;
  const today = todayInTimeZone(settings.timezone);
  const first = raw && /^\d{4}-\d{2}$/.test(raw) ? day(`${raw}-01`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const prev = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  const [{ staff, entries }, t, tr] = await Promise.all([leaveCalendar(tenantId, first), getTranslations("leave"), getTranslations("roles")]);
  const days = monthDays(first.getUTCFullYear(), first.getUTCMonth());
  const monthName = new Intl.DateTimeFormat(settings.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const away = staff.filter((s) => entries.some((e) => e.userId === s.id));
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const cell = (userId: string, d: Date) => {
    const k = iso(d);
    const hit = entries.find((e) => e.userId === userId && e.startDate <= k && e.endDate >= k);
    return hit?.kind ?? null;
  };
  const date = (s: string) => formatDateOnly(s, settings);

  return (
    <div className="space-y-6">
      <PageHeader title={t("calendarTitle")} description={t("calendarDescription")} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/leave/calendar?month=${iso(prev).slice(0, 7)}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={t("prevMonth")}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <h2 className="min-w-40 text-center font-semibold">{monthName}</h2>
        <Link href={`/leave/calendar?month=${iso(next).slice(0, 7)}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={t("nextMonth")}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <span className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-sm bg-warning" />{t("legendApproved")}</span>
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-sm border border-dashed border-warning bg-warning/20" />{t("legendPending")}</span>
        </span>
      </div>

      {away.length === 0 ? (
        <EmptyState icon={<CalendarOff className="h-6 w-6" />} title={t("nobodyAway")} description={t("nobodyAwayHint")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[56rem] border-collapse text-xs">
            <caption className="sr-only">{t("calendarCaption", { month: monthName })}</caption>
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="sticky left-0 bg-muted/50 px-3 py-2 text-left font-medium">{t("col.staff")}</th>
                {days.map((d) => (
                  <th key={iso(d)} scope="col" className={`w-7 px-0 py-2 text-center font-medium ${d.getUTCDay() === 0 || d.getUTCDay() === 6 ? "text-muted-foreground/60" : ""}`}>
                    {d.getUTCDate()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {away.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className="sticky left-0 bg-background px-3 py-1.5 text-left font-normal">
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-muted-foreground">{tr(s.role as never)}</span>
                  </th>
                  {days.map((d) => {
                    const k = cell(s.id, d);
                    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
                    return (
                      <td key={iso(d)} className={`h-8 p-0.5 ${weekend ? "bg-muted/40" : ""}`}>
                        {k ? <span title={t(k === "approved" ? "legendApproved" : "legendPending")} className={`block h-full w-full rounded-sm ${k === "approved" ? "bg-warning" : "border border-dashed border-warning bg-warning/20"}`} /> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.length ? (
        <section aria-labelledby="lv-list" className="space-y-3">
          <h2 id="lv-list" className="font-semibold">{t("thisMonth")}</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {entries
              .slice()
              .sort((a, b) => a.startDate.localeCompare(b.startDate))
              .map((e) => (
                <li key={`${e.kind}-${e.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <span className="font-medium">{nameOf.get(e.userId) ?? "—"}</span> · {e.leaveType} · {t("range", { from: date(e.startDate), to: date(e.endDate) })} · {t("days", { count: e.days })}
                  </span>
                  <span className="flex items-center gap-2">
                    {e.kind === "approved" ? (
                      <>
                        <Badge variant="success">{t("legendApproved")}</Badge>
                        <CancelLeaveButton leaveId={e.id} label={`${nameOf.get(e.userId) ?? ""} · ${e.leaveType}`} />
                      </>
                    ) : (
                      <Link href={`/approvals/${e.id}`} className="underline underline-offset-2">
                        {t("review")}
                      </Link>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
