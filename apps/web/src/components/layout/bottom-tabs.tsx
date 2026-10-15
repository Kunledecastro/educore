"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@educore/ui/utils";
import type { NavItem } from "@/lib/nav";
import { NAV_ICONS } from "./nav-icons";

/**
 * Phone tab bar for families (Phase 9.1): the four places parents and pupils
 * go most, always one thumb away. Staff keep the slide-in menu.
 */
export function BottomTabs({ items }: { items: NavItem[] }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  if (items.length === 0) return null;
  return (
    <nav aria-label={t("quickNavigation")} className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)) || pathname === item.href;
          const Icon = NAV_ICONS[item.icon];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", active ? "text-primary" : "text-muted-foreground")}
              >
                <span className="relative">
                  <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
                  {item.badge ? <span className="absolute -right-2 -top-1 rounded-full bg-ink px-1.5 text-[10px] font-bold text-ink-foreground">{item.badge > 9 ? "9+" : item.badge}</span> : null}
                </span>
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
