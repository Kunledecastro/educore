"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@educore/ui/input";

/** Find a pupil by name, admission number or class, then go to the visit form. */
export function PupilPicker({ pupils }: { pupils: { id: string; name: string; admissionNo: string; classLabel: string }[] }) {
  const t = useTranslations("health.visits");
  const [q, setQ] = React.useState("");
  const id = React.useId();
  const needle = q.trim().toLowerCase();
  const hits = needle.length < 2 ? [] : pupils.filter((p) => `${p.name} ${p.admissionNo} ${p.classLabel}`.toLowerCase().includes(needle)).slice(0, 12);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t("findPupil")}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("findPupilPlaceholder")} className="pl-8" autoComplete="off" aria-describedby={`${id}-status`} />
      </div>
      <p id={`${id}-status`} className="sr-only" aria-live="polite">
        {needle.length >= 2 ? t("matches", { count: hits.length }) : ""}
      </p>
      {hits.length ? (
        <ul className="divide-y rounded-md border">
          {hits.map((p) => (
            <li key={p.id}>
              <Link href={`/clinic/visits/new?student=${p.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  {p.admissionNo}
                  {p.classLabel ? ` · ${p.classLabel}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : needle.length >= 2 ? (
        <p className="text-sm text-muted-foreground">{t("noMatch")}</p>
      ) : null}
    </div>
  );
}
