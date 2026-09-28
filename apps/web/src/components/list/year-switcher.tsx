"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select } from "@educore/ui/select";
import { buildListQuery } from "@/lib/list-params";

/** Switches `?year=` for pages that show one academic year at a time. */
export function YearSwitcher({
  years,
  selectedId,
}: {
  years: { id: string; name: string; isActive: boolean }[];
  selectedId: string;
}) {
  const t = useTranslations("academics.classes");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();
  const id = React.useId();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="whitespace-nowrap text-sm text-muted-foreground">
        {t("yearSwitcher")}
      </label>
      <Select
        id={id}
        className="w-auto min-w-40"
        value={selectedId}
        onChange={(e) =>
          startTransition(() => router.replace(`${pathname}${buildListQuery(searchParams, { year: e.target.value })}`))
        }
      >
        {years.map((y) => (
          <option key={y.id} value={y.id}>
            {y.name} {y.isActive ? t("activeSuffix") : ""}
          </option>
        ))}
      </Select>
    </div>
  );
}
