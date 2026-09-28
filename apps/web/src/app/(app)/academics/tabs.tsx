"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@educore/ui/utils";

const TABS = [
  { href: "/academics", key: "years" },
  { href: "/academics/classes", key: "classes" },
  { href: "/academics/subjects", key: "subjects" },
  { href: "/academics/assignments", key: "assignments" },
] as const;

export function AcademicsTabs() {
  const t = useTranslations("academics.tabs");
  const pathname = usePathname();
  return (
    <nav aria-label={t("years")} className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b">
      {TABS.map((tab) => {
        const active = tab.href === "/academics" ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
