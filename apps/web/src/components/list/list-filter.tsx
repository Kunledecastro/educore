"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Select } from "@educore/ui/select";
import { buildListQuery } from "@/lib/list-params";

export interface FilterOption {
  value: string;
  label: string;
}

/** A single dropdown filter bound to `?{name}=`. Empty choice = no filter. */
export function ListFilter({ name, label, options }: { name: string; label: string; options: FilterOption[] }) {
  const t = useTranslations("list");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();
  const id = React.useId();

  return (
    <div className="w-full sm:w-44">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        value={searchParams.get(name) ?? ""}
        onChange={(e) =>
          startTransition(() => router.replace(`${pathname}${buildListQuery(searchParams, { [name]: e.target.value })}`))
        }
      >
        <option value="">{t("allOf", { label })}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
