"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buildListQuery } from "@/lib/list-params";
import { useTranslations } from "next-intl";
import { Select } from "@educore/ui/select";

/** Switches `?term=` for per-term summaries. */
export function TermSwitcher({ terms, selectedId }: { terms: { id: string; name: string }[]; selectedId: string }) {
  const t = useTranslations("attendance");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {t("term")}
      </label>
      <Select
        id={id}
        className="w-auto min-w-40"
        value={selectedId}
        onChange={(e) => startTransition(() => router.replace(`${pathname}${buildListQuery(searchParams, { term: e.target.value })}`))}
      >
        {terms.map((term) => (
          <option key={term.id} value={term.id}>
            {term.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
