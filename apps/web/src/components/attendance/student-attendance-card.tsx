import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import type { TenantScopedClient } from "@educore/db";
import { summarizeAttendance } from "@/lib/attendance";
import { formatDateOnly, formatNumber, todayInTimeZone } from "@/lib/format";
import type { TenantSettings } from "@/lib/tenant-settings";
import { resolveTermRange } from "@/lib/term-range";

const BADGE = { ABSENT: "destructive", LATE: "warning", EXCUSED: "secondary", PRESENT: "success" } as const;

/**
 * Attendance for one student this term, on their profile — which is how
 * parents see their child's attendance. The caller has already applied the
 * student row scope (a parent only ever reaches their own child here).
 */
export async function StudentAttendanceCard({
  db,
  studentId,
  year,
  settings,
}: {
  db: TenantScopedClient;
  studentId: string;
  year: { id: string; name: string; startDate: Date; endDate: Date };
  settings: TenantSettings;
}) {
  const t = await getTranslations("attendance");
  const range = await resolveTermRange(db, year, undefined, todayInTimeZone(settings.timezone));
  const records = await db.attendance.findMany({
    where: { studentId, date: { gte: range.from, lte: range.to } },
    select: { date: true, status: true, remarks: true },
    orderBy: { date: "desc" },
  });
  const c = summarizeAttendance(records.map((r) => r.status));
  const notPresent = records.filter((r) => r.status !== "PRESENT").slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("profileTitle", { label: range.label })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {c.marked === 0 ? (
          <p className="text-sm text-muted-foreground">{t("profileEmpty")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <p className="text-3xl font-semibold tabular-nums">{c.rate === null ? "—" : `${formatNumber(c.rate, settings)}%`}</p>
                <p className="text-xs text-muted-foreground">{t("rate")}</p>
              </div>
              <dl className="grid grid-cols-4 gap-4 text-sm">
                {(["present", "absent", "late", "excused"] as const).map((k) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{t(`status.${k.toUpperCase() as "PRESENT"}`)}</dt>
                    <dd className="font-medium tabular-nums">{c[k]}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {notPresent.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("recentAbsences")}</h3>
                <ul className="divide-y rounded-md border text-sm">
                  {notPresent.map((r) => (
                    <li key={r.date.toISOString()} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>{formatDateOnly(r.date, settings)}</span>
                      <span className="flex items-center gap-2">
                        {r.remarks ? <span className="text-muted-foreground">{r.remarks}</span> : null}
                        <Badge variant={BADGE[r.status]}>{t(`status.${r.status}`)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("rateExplained")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
