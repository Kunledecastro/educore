"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { saveSignups } from "../actions";

/** Tick-list of a section's students for one optional item and term. */
export function SignupsEditor({
  termId,
  feeTypeId,
  sectionId,
  caption,
  students,
  signedUp,
  readOnly,
}: {
  termId: string;
  feeTypeId: string;
  sectionId: string;
  caption: string;
  students: { id: string; name: string; admissionNo: string }[];
  signedUp: string[];
  readOnly: boolean;
}) {
  const t = useTranslations("fees.optional");
  const tc = useTranslations("common");
  const router = useRouter();
  const initial = React.useMemo(() => new Set(signedUp), [signedUp]);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(signedUp));
  const [pending, startTransition] = React.useTransition();
  const dirty = selected.size !== initial.size || [...selected].some((id) => !initial.has(id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = () =>
    startTransition(async () => {
      const result = await saveSignups({ termId, feeTypeId, sectionId, studentIds: [...selected] });
      if (result.ok) {
        toast.success(t("saved", { count: selected.size }));
        router.refresh();
      } else toast.error(result.error);
    });

  return (
    <div className="space-y-3">
      <fieldset className="rounded-lg border" disabled={readOnly || pending}>
        <legend className="sr-only">{caption}</legend>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {t("count", { count: selected.size, total: students.length })}
          </span>
          {!readOnly ? (
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set(students.map((s) => s.id)))}>
                {t("all")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                {t("none")}
              </Button>
            </div>
          ) : null}
        </div>
        <ul className="divide-y">
          {students.map((s) => (
            <li key={s.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/50" htmlFor={`signup-${s.id}`}>
                <input
                  id={`signup-${s.id}`}
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={selected.has(s.id)}
                  onChange={(e) => toggle(s.id, e.target.checked)}
                />
                <span className="flex-1 text-sm font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.admissionNo}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty ? <span className="text-sm text-muted-foreground">{t("unsaved")}</span> : null}
          <Button type="button" variant="ghost" disabled={pending || !dirty} onClick={() => setSelected(new Set(initial))}>
            {t("discard")}
          </Button>
          <Button type="button" onClick={save} disabled={pending || !dirty}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
