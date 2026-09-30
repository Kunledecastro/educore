"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select } from "@educore/ui/select";
import { buildListQuery } from "@/lib/list-params";

export function ClassSwitcher({ classes, selectedId }: { classes: { id: string; name: string }[]; selectedId: string }) {
  const t = useTranslations("gradebook");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {t("class")}
      </label>
      <Select
        id={id}
        className="w-auto min-w-36"
        value={selectedId}
        onChange={(e) => startTransition(() => router.replace(`${pathname}${buildListQuery(searchParams, { class: e.target.value })}`))}
      >
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
