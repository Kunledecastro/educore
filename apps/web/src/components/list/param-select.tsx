"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@educore/ui/select";
import { buildListQuery } from "@/lib/list-params";

/** A labelled <select> that sets one URL query parameter (e.g. ?section=). */
export function ParamSelect({
  param,
  label,
  options,
  selected,
}: {
  param: string;
  label: string;
  options: { value: string; label: string }[];
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();
  const id = React.useId();
  return (
    <div className="flex items-center gap-2 print:hidden">
      <label htmlFor={id} className="whitespace-nowrap text-sm text-muted-foreground">
        {label}
      </label>
      <Select
        id={id}
        className="w-auto min-w-40"
        value={selected}
        onChange={(e) => startTransition(() => router.replace(`${pathname}${buildListQuery(searchParams, { [param]: e.target.value })}`))}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
