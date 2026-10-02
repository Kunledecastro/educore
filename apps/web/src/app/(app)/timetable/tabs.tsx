"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@educore/ui/utils";

/** Admins: Class timetables | Teacher timetables | Bell schedule. */
export function TimetableTabs() {
  const t = useTranslations("timetable.tabs");
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  const tabs = [
    { href: "/timetable", key: "sections", active: pathname === "/timetable" && view !== "teacher" },
    { href: "/timetable?view=teacher", key: "teachers", active: pathname === "/timetable" && view === "teacher" },
    { href: "/timetable/periods", key: "periods", active: pathname.startsWith("/timetable/periods") },
  ] as const;
  return (
    <nav aria-label={t("label")} className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b print:hidden">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tab.active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
