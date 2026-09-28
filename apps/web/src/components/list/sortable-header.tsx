"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@educore/ui/table";
import { cn } from "@educore/ui/utils";
import { buildListQuery } from "@/lib/list-params";

/**
 * Column header that toggles `?sort=&dir=`. `defaultSort` must match the
 * page's list config so the initial arrow is shown on the right column.
 */
export function SortableHeader({
  column,
  label,
  defaultSort,
  defaultDir = "asc",
  className,
}: {
  column: string;
  label: string;
  defaultSort: string;
  defaultDir?: "asc" | "desc";
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSort = searchParams.get("sort") ?? defaultSort;
  const activeDir = (searchParams.get("dir") as "asc" | "desc" | null) ?? defaultDir;
  const isActive = activeSort === column;
  const nextDir = isActive && activeDir === "asc" ? "desc" : "asc";
  const Icon = !isActive ? ArrowUpDown : activeDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead aria-sort={isActive ? (activeDir === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <Link
        href={`${pathname}${buildListQuery(searchParams, { sort: column, dir: nextDir })}`}
        replace
        scroll={false}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "text-foreground",
        )}
      >
        {label}
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </TableHead>
  );
}
