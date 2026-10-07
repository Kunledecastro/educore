import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import type { VisitRow } from "@/lib/health/visits";

const OUTCOME_VARIANT = { BACK_TO_CLASS: "success", RESTED: "secondary", SENT_HOME: "destructive", REFERRED: "destructive" } as const;

/**
 * Clinic visits as a list. A "summary" row (teachers, admins without full
 * access) shows only when and the outcome; a "full" row adds the complaint,
 * care and any medicine given.
 */
export async function VisitList({ visits, fmt, showPupil = false, editable = false, empty }: { visits: VisitRow[]; fmt: { time: (d: Date) => string; dateTime: (d: Date) => string }; showPupil?: boolean; editable?: boolean; empty?: string }) {
  const t = await getTranslations("health.visits");
  const tm = await getTranslations("health.profile.medicines");
  if (visits.length === 0) return <p className="text-sm text-muted-foreground">{empty ?? t("none")}</p>;
  return (
    <ul className="divide-y rounded-md border">
      {visits.map((v) => (
        <li key={v.id} className={v.urgent ? "border-l-4 border-l-destructive p-3" : "p-3"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {showPupil ? (
                <>
                  <span className="font-medium">{v.pupil}</span>
                  {v.classLabel ? <span className="text-muted-foreground"> · {v.classLabel}</span> : null}
                  {" · "}
                </>
              ) : null}
              <span className="font-medium">{fmt.dateTime(v.arrivedAt)}</span>
              {v.leftAt ? ` – ${fmt.time(v.leftAt)}` : ""}
              {v.complaint ? <span> · {t(`complaints.${v.complaint}`)}</span> : null}
            </p>
            <div className="flex items-center gap-2">
              {v.outcome ? <Badge variant={OUTCOME_VARIANT[v.outcome]}>{t(`outcomes.${v.outcome}`)}</Badge> : <Badge variant="warning">{t("stillHere")}</Badge>}
              {editable && v.view === "full" ? (
                <Link href={`/clinic/visits/${v.id}`} className="text-sm underline underline-offset-2">
                  {t("edit")}
                </Link>
              ) : null}
            </div>
          </div>
          {v.detail ? (
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
              {v.detail.complaintNote ? (
                <>
                  <dt className="text-muted-foreground">{t("complaintNote")}</dt>
                  <dd>{v.detail.complaintNote}</dd>
                </>
              ) : null}
              {v.detail.temperature !== null ? (
                <>
                  <dt className="text-muted-foreground">{t("temperature")}</dt>
                  <dd>{v.detail.temperature} °C</dd>
                </>
              ) : null}
              {v.detail.observations ? (
                <>
                  <dt className="text-muted-foreground">{t("observations")}</dt>
                  <dd className="whitespace-pre-line">{v.detail.observations}</dd>
                </>
              ) : null}
              {v.detail.careGiven ? (
                <>
                  <dt className="text-muted-foreground">{t("careGiven")}</dt>
                  <dd className="whitespace-pre-line">{v.detail.careGiven}</dd>
                </>
              ) : null}
              {v.detail.medicines.length ? (
                <>
                  <dt className="text-muted-foreground">{t("medicines")}</dt>
                  <dd>{v.detail.medicines.map((m) => `${m.code === "own" ? m.name : tm(m.code as never)} — ${m.dose} (${m.time})`).join("; ")}</dd>
                </>
              ) : null}
              {v.detail.outcomeNote ? (
                <>
                  <dt className="text-muted-foreground">{t("outcomeNote")}</dt>
                  <dd>{v.detail.outcomeNote}</dd>
                </>
              ) : null}
              {v.detail.recordedByName ? (
                <>
                  <dt className="text-muted-foreground">{t("recordedBy")}</dt>
                  <dd>{v.detail.recordedByName}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
