"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@educore/ui/input";
import { buildListQuery } from "@/lib/list-params";

/** Debounced search box bound to `?q=`. */
export function ListSearch({ placeholder }: { placeholder?: string }) {
  const t = useTranslations("list");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(searchParams.get("q") ?? "");
  const [, startTransition] = React.useTransition();

  // Keep the box in sync if the URL changes elsewhere (e.g. "clear filters").
  React.useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  React.useEffect(() => {
    const current = searchParams.get("q") ?? "";
    if (value.trim() === current) return;
    const handle = setTimeout(() => {
      startTransition(() => router.replace(`${pathname}${buildListQuery(searchParams, { q: value.trim() })}`));
    }, 300);
    return () => clearTimeout(handle);
  }, [value, pathname, router, searchParams]);

  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? t("searchPlaceholder")}
        aria-label={placeholder ?? t("searchPlaceholder")}
        className="pl-9 pr-9"
        maxLength={100}
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("clearSearch")}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
