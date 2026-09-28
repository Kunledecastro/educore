"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { GraduationCap, LogOut, Menu, X } from "lucide-react";
import { cn } from "@educore/ui/utils";
import type { NavItem } from "@/lib/nav";
import { NAV_ICONS } from "./nav-icons";
import type { Role } from "@educore/db";

interface SidebarProps {
  items: NavItem[];
  role: Role;
  tenantName: string | null;
}

function Brand({ role, tenantName }: Pick<SidebarProps, "role" | "tenantName">) {
  const tr = useTranslations("roles");
  return (
    <div className="flex items-center gap-2">
      <GraduationCap className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold">{tenantName ?? "EduCore"}</span>
        <span className="text-xs text-muted-foreground">{tr(role)}</span>
      </div>
    </div>
  );
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label={t("mainNavigation")}>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

function SignOutButton() {
  const t = useTranslations("common");
  return (
    <div className="border-t p-3">
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {t("signOut")}
      </button>
    </div>
  );
}

/** Fixed sidebar on tablets/desktops (md and up). */
export function Sidebar({ items, role, tenantName }: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-card md:flex">
      <div className="border-b px-5 py-4">
        <Brand role={role} tenantName={tenantName} />
      </div>
      <NavLinks items={items} />
      <SignOutButton />
    </aside>
  );
}

/** Top bar + slide-in menu on phones (below md, down to 375px). */
export function MobileNav({ items, role, tenantName }: SidebarProps) {
  const t = useTranslations("nav");
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
        <Brand role={role} tenantName={tenantName} />
        <DialogPrimitive.Trigger
          className="rounded-md p-2 text-muted-foreground hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("openMenu")}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </DialogPrimitive.Trigger>
      </header>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 md:hidden" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-card shadow-lg focus:outline-none md:hidden">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <DialogPrimitive.Title asChild>
              <div>
                <Brand role={role} tenantName={tenantName} />
              </div>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="rounded-md p-2 text-muted-foreground hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("closeMenu")}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">{t("mainNavigation")}</DialogPrimitive.Description>
          <NavLinks items={items} onNavigate={() => setOpen(false)} />
          <SignOutButton />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
