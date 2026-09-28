"use client";

import Link from "next/link";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { buttonVariants } from "@educore/ui/button";
import { Select } from "@educore/ui/select";
import { cn } from "@educore/ui/utils";
import { buildListQuery, DEFAULT_PAGE_SIZES, pageRange } from "@/lib/list-params";

export function ListPagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const t = useTranslations("list");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();
  const sizeId = React.useId();
  const { from, to, pageCount, hasPrev, hasNext } = pageRange(page, pageSize, total);

  const href = (p: number) => `${pathname}${buildListQuery(searchParams, { page: p === 1 ? null : p })}`;
  const linkClass = (enabled: boolean) =>
    cn(buttonVariants({ variant: "outline", size: "sm" }), !enabled && "pointer-events-none opacity-50");

  return (
    <nav className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between" aria-label={t("pagination")}>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("showing", { from: format.number(from), to: format.number(to), total: format.number(total) })}
      </p>
      <div className="flex items-center gap-2">
        <label htmlFor={sizeId} className="whitespace-nowrap text-sm text-muted-foreground">
          {t("rowsPerPage")}
        </label>
        <Select
          id={sizeId}
          className="h-9 w-20"
          value={String(pageSize)}
          onChange={(e) =>
            startTransition(() => router.replace(`${pathname}${buildListQuery(searchParams, { size: e.target.value })}`))
          }
        >
          {DEFAULT_PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Link href={href(page - 1)} aria-disabled={!hasPrev} tabIndex={hasPrev ? undefined : -1} className={linkClass(hasPrev)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{t("previous")}</span>
        </Link>
        <span className="text-sm tabular-nums text-muted-foreground">
          {t("pageOf", { page: format.number(page), pageCount: format.number(pageCount) })}
        </span>
        <Link href={href(page + 1)} aria-disabled={!hasNext} tabIndex={hasNext ? undefined : -1} className={linkClass(hasNext)}>
          <span className="sr-only sm:not-sr-only">{t("next")}</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </nav>
  );
}
