"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { GraduationCap, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";
import type { Role } from "@educore/db";

export function Sidebar({
  items,
  role,
  tenantName,
}: {
  items: NavItem[];
  role: Role;
  tenantName: string | null;
}) {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <GraduationCap className="h-6 w-6 text-primary" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">{tenantName ?? "EduCore"}</span>
          <span className="text-xs text-muted-foreground">{role.replaceAll("_", " ")}</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
