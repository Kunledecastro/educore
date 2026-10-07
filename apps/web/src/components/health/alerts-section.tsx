"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@educore/ui/badge";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { ConfirmAction } from "@/components/form/confirm-action";
import { deleteAlertAction, saveAlertAction } from "@/app/(app)/clinic/actions";
import { ALERT_CATEGORIES, ALERT_SEVERITIES, type AlertCategory, type AlertSeverity } from "@/lib/health/rules";

export interface AlertItem {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  text: string;
}

const VARIANT = { SEVERE: "destructive", MODERATE: "warning", MILD: "secondary" } as const;

/** A pupil's alerts on their health record: everyone who may open the record sees them; the nurse writes them. */
export function AlertsSection({ studentId, alerts, canManage }: { studentId: string; alerts: AlertItem[]; canManage: boolean }) {
  const t = useTranslations("health.alerts");
  const router = useRouter();
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  return (
    <section className="space-y-3 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        {canManage && editing === null && alerts.length < 10 ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("add")}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{canManage ? t("explainNurse") : t("explain")}</p>
      {alerts.length === 0 && editing !== "new" ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      <ul className="space-y-2">
        {alerts.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AlertForm studentId={studentId} initial={a} onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={a.id} className="flex items-start justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={VARIANT[a.severity]}>{t(`severity.${a.severity}`)}</Badge>
                  <span className="text-sm font-medium">{t(`category.${a.category}`)}</span>
                </div>
                <p className="text-sm">{a.text}</p>
              </div>
              {canManage && editing === null ? (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" aria-label={t("editNamed", { category: t(`category.${a.category}`) })} onClick={() => setEditing(a.id)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <ConfirmAction
                    trigger={
                      <Button variant="ghost" size="sm" className="text-destructive" aria-label={t("removeNamed", { category: t(`category.${a.category}`) })}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    }
                    title={t("removeTitle")}
                    description={t("removeDescription")}
                    confirmLabel={t("remove")}
                    action={() => deleteAlertAction(a.id)}
                    successMessage={t("removed")}
                    onSuccess={() => router.refresh()}
                  />
                </div>
              ) : null}
            </li>
          ),
        )}
        {editing === "new" ? (
          <li>
            <AlertForm studentId={studentId} onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function AlertForm({ studentId, initial, onDone, onCancel }: { studentId: string; initial?: AlertItem; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations("health.alerts");
  const [category, setCategory] = React.useState<AlertCategory>(initial?.category ?? "ALLERGY");
  const [severity, setSeverity] = React.useState<AlertSeverity>(initial?.severity ?? "SEVERE");
  const [text, setText] = React.useState(initial?.text ?? "");
  const [pending, start] = React.useTransition();
  const tooShort = text.trim().length < 3;
  const id = React.useId();
  return (
    <form
      className="space-y-3 rounded-md border bg-muted/30 p-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (tooShort) return;
        start(async () => {
          const r = await saveAlertAction(studentId, initial?.id ?? null, { category, severity, text });
          if (r.ok) {
            toast.success(t("saved"));
            onDone();
          } else toast.error(r.error);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-cat`} className="text-sm font-medium">
            {t("categoryLabel")}
          </label>
          <Select id={`${id}-cat`} value={category} onChange={(e) => setCategory(e.target.value as AlertCategory)}>
            {ALERT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-sev`} className="text-sm font-medium">
            {t("severityLabel")}
          </label>
          <Select id={`${id}-sev`} value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>
            {ALERT_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t(`severity.${s}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          {t("textLabel")}
        </label>
        <Input id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={t("textPlaceholder")} aria-describedby={`${id}-hint`} />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {t("textHint", { left: 200 - text.length })}
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || tooShort}>
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
