"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@educore/ui/badge";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { Textarea } from "@educore/ui/textarea";
import { saveVisitAction, visitOptionsAction } from "@/app/(app)/clinic/actions";
import type { BadgeAlert } from "@/components/health/alert-badge";
import { COMPLAINTS, OUTCOMES } from "@/lib/health/rules";

export interface VisitFormValues {
  arrivedAt: string; // local "YYYY-MM-DDTHH:mm"
  leftAt: string;
  complaint: string;
  complaintNote: string;
  temperature: string;
  observations: string;
  careGiven: string;
  medicines: { code: string; name: string; dose: string; time: string }[];
  outcome: string;
  outcomeNote: string;
}

interface Options {
  hasProfile: boolean;
  permitted: string[];
  ownAtSchool: string[];
  contacts: { name: string; relationship: string; phone: string }[];
}

/**
 * Record or correct a clinic visit (Phase 7.2). Only medicines the parent
 * permitted (or the pupil's own medicine taken at school) can be chosen;
 * the server checks again. Parents are told when it's saved.
 */
export function VisitForm({
  studentId,
  pupilName,
  alerts,
  visitId,
  initial,
  nowLocal,
}: {
  studentId: string;
  pupilName: string;
  alerts: BadgeAlert[];
  visitId?: string;
  initial?: VisitFormValues;
  nowLocal: string;
}) {
  const t = useTranslations("health.visits");
  const tm = useTranslations("health.profile.medicines");
  const ta = useTranslations("health.alerts");
  const router = useRouter();
  const [opts, setOpts] = React.useState<Options | null>(null);
  const [v, setV] = React.useState<VisitFormValues>(
    initial ?? { arrivedAt: nowLocal, leftAt: "", complaint: "HEADACHE", complaintNote: "", temperature: "", observations: "", careGiven: "", medicines: [], outcome: "", outcomeNote: "" },
  );
  const [pending, start] = React.useTransition();
  const set = <K extends keyof VisitFormValues>(k: K, val: VisitFormValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const id = React.useId();

  React.useEffect(() => {
    let live = true;
    void visitOptionsAction(studentId).then((r) => {
      if (!live) return;
      if (r.ok) setOpts(r.data as Options);
      else toast.error(r.error);
    });
    return () => {
      live = false;
    };
  }, [studentId]);

  const choices = opts ? [...opts.permitted.map((c) => ({ code: c, name: "", label: tm(c as never) })), ...opts.ownAtSchool.map((n) => ({ code: "own", name: n, label: t("ownMedicine", { name: n }) }))] : [];
  const timeNow = () => nowLocal.slice(11, 16);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await saveVisitAction(studentId, visitId ?? null, v);
      if (r.ok) {
        toast.success(visitId ? t("updated") : t("saved"));
        router.push(`/clinic/${studentId}`);
        router.refresh();
      } else toast.error(Object.values(r.fieldErrors ?? {})[0] ?? r.error);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <section className="space-y-2 rounded-lg border bg-card p-4" aria-label={t("aboutPupil")}>
        <p className="font-semibold">{pupilName}</p>
        {alerts.length ? (
          <ul className="space-y-1 text-sm">
            {alerts.map((a, i) => (
              <li key={i}>
                <Badge variant={a.severity === "SEVERE" ? "destructive" : a.severity === "MODERATE" ? "warning" : "secondary"} className="mr-2">
                  {ta(`severity.${a.severity}`)}
                </Badge>
                <span className="font-medium">{ta(`category.${a.category}`)}:</span> {a.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{ta("none")}</p>
        )}
        {opts?.contacts.length ? (
          <p className="text-sm">
            <span className="text-muted-foreground">{t("callFirst")}: </span>
            {opts.contacts.map((c, i) => (
              <span key={i}>
                {i ? " · " : ""}
                {c.name}
                {c.relationship ? ` (${c.relationship})` : ""} <a className="underline underline-offset-2" href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}>{c.phone}</a>
              </span>
            ))}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-in`} className="text-sm font-medium">
            {t("arrivedAt")}
          </label>
          <Input id={`${id}-in`} type="datetime-local" value={v.arrivedAt} max={nowLocal} onChange={(e) => set("arrivedAt", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-out`} className="text-sm font-medium">
            {t("leftAt")}
          </label>
          <div className="flex gap-2">
            <Input id={`${id}-out`} type="datetime-local" value={v.leftAt} min={v.arrivedAt} onChange={(e) => set("leftAt", e.target.value)} />
            <Button type="button" variant="outline" size="sm" onClick={() => set("leftAt", nowLocal)}>
              {t("now")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("leftAtHint")}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-c`} className="text-sm font-medium">
            {t("complaint")}
          </label>
          <Select id={`${id}-c`} value={v.complaint} onChange={(e) => set("complaint", e.target.value)}>
            {COMPLAINTS.map((c) => (
              <option key={c} value={c}>
                {t(`complaints.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-cn`} className="text-sm font-medium">
            {t("complaintNote")}
          </label>
          <Input id={`${id}-cn`} value={v.complaintNote} maxLength={300} onChange={(e) => set("complaintNote", e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-t`} className="text-sm font-medium">
            {t("temperature")}
          </label>
          <Input id={`${id}-t`} type="number" inputMode="decimal" step="0.1" min={30} max={45} value={v.temperature} onChange={(e) => set("temperature", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-o`} className="text-sm font-medium">
            {t("observations")}
          </label>
          <Textarea id={`${id}-o`} rows={2} maxLength={1000} value={v.observations} onChange={(e) => set("observations", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${id}-care`} className="text-sm font-medium">
          {t("careGiven")}
        </label>
        <Textarea id={`${id}-care`} rows={2} maxLength={1000} value={v.careGiven} onChange={(e) => set("careGiven", e.target.value)} placeholder={t("careGivenPlaceholder")} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("medicines")}</legend>
        {opts === null ? (
          <p className="text-sm text-muted-foreground">{t("loadingPermissions")}</p>
        ) : choices.length === 0 ? (
          <p className="rounded-md border border-warning bg-warning/10 p-3 text-sm">{opts.hasProfile ? t("noneAllowed") : t("noProfile")}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t("allowedHint", { list: choices.map((c) => c.label).join(", ") })}</p>
            {v.medicines.map((m, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_7rem_auto]">
                <Select
                  aria-label={t("medicineN", { n: i + 1 })}
                  value={`${m.code}|${m.name}`}
                  onChange={(e) => {
                    const [code, ...rest] = e.target.value.split("|");
                    set("medicines", v.medicines.map((x, j) => (j === i ? { ...x, code: code!, name: rest.join("|") } : x)));
                  }}
                >
                  {choices.map((c) => (
                    <option key={`${c.code}|${c.name}`} value={`${c.code}|${c.name}`}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <Input aria-label={t("dose")} placeholder={t("dosePlaceholder")} value={m.dose} maxLength={120} onChange={(e) => set("medicines", v.medicines.map((x, j) => (j === i ? { ...x, dose: e.target.value } : x)))} />
                <Input aria-label={t("time")} type="time" value={m.time} onChange={(e) => set("medicines", v.medicines.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="sm" aria-label={t("removeMedicine")} onClick={() => set("medicines", v.medicines.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            {v.medicines.length < 10 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => set("medicines", [...v.medicines, { code: choices[0]!.code, name: choices[0]!.name, dose: "", time: timeNow() }])}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("addMedicine")}
              </Button>
            ) : null}
          </>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-out2`} className="text-sm font-medium">
            {t("outcome")}
          </label>
          <Select id={`${id}-out2`} value={v.outcome} onChange={(e) => set("outcome", e.target.value)}>
            <option value="">{t("stillHere")}</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {t(`outcomes.${o}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-on`} className="text-sm font-medium">
            {t("outcomeNote")}
          </label>
          <Input id={`${id}-on`} value={v.outcomeNote} maxLength={500} onChange={(e) => set("outcomeNote", e.target.value)} placeholder={t("outcomeNotePlaceholder")} />
        </div>
      </div>
      {v.outcome === "SENT_HOME" || v.outcome === "REFERRED" ? <p className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">{t("urgentNote")}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || v.medicines.some((m) => !m.dose.trim() || !m.time)}>
          {pending ? t("saving") : visitId ? t("saveChanges") : t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          {t("cancel")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("parentsTold")}</p>
    </form>
  );
}
