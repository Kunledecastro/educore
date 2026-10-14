"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { GraduationCap, LifeBuoy, LogOut, Menu, Monitor, Moon, ShieldCheck, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@educore/ui/utils";
import type { NavItem } from "@/lib/nav";
import { SUPPORT, whatsappLink } from "@/lib/support";
import { NAV_ICONS } from "./nav-icons";
import type { Role } from "@educore/db";

interface SidebarProps {
  items: NavItem[];
  role: Role;
  tenantName: string | null;
  /** The school's logo (branding), if it has one. */
  logoUrl?: string | null;
}

/** "Greenfield Academy" → "GA" for schools without a logo. */
function initials(name: string | null): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function Brand({ role, tenantName, logoUrl }: Pick<SidebarProps, "role" | "tenantName" | "logoUrl">) {
  const tr = useTranslations("roles");
  return (
    <div className="flex items-center gap-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- small, versioned, same-origin logo
        <img src={logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl border bg-card object-contain p-0.5" />
      ) : (
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
          {initials(tenantName) || <GraduationCap className="h-5 w-5" />}
        </span>
      )}
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-bold tracking-tight">{tenantName ?? "EduCore"}</span>
        <span className="text-xs text-muted-foreground">{tr(role)}</span>
      </div>
    </div>
  );
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4" aria-label={t("mainNavigation")}>
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
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-accent font-semibold text-accent-foreground" : "font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("h-[18px] w-[18px]", active ? "text-primary" : "")} aria-hidden="true" />
            {t(item.labelKey)}
            {item.badge ? (
              <span className="ml-auto rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-ink-foreground">
                {item.badge > 99 ? "99+" : item.badge}
                <span className="sr-only"> {t("unread")}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Light, dark or follow the device (Phase 9). Remembered by next-themes in this browser. */
function ThemeSwitch() {
  const t = useTranslations("common");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const options = [
    { value: "light", label: t("themeLight"), Icon: Sun },
    { value: "dark", label: t("themeDark"), Icon: Moon },
    { value: "system", label: t("themeSystem"), Icon: Monitor },
  ] as const;
  return (
    <div role="radiogroup" aria-label={t("theme")} className="mx-3 my-1 grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
      {options.map(({ value, label, Icon }) => {
        const on = mounted && (theme ?? "system") === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn("flex h-8 items-center justify-center rounded-full text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-card text-foreground shadow-sm" : "hover:text-foreground")}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * EduCore support, for the people who run the school's account. Teachers,
 * parents and pupils get help from their school, not from us.
 */
function SupportLink({ role }: { role: Role }) {
  const t = useTranslations("common");
  if (role !== "SCHOOL_ADMIN" && role !== "ACCOUNTANT") return null;
  const href = SUPPORT.whatsapp ? whatsappLink(SUPPORT.whatsapp, t("supportMessage")) : SUPPORT.email ? `mailto:${SUPPORT.email}` : "/contact";
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <LifeBuoy className="h-4 w-4" aria-hidden="true" />
      {t("support")}
    </a>
  );
}

function SignOutButton({ role }: { role: Role }) {
  const t = useTranslations("common");
  // Pupils change their password on its own page; everyone else manages sign-in security here (Phase 6).
  const href = role === "STUDENT" ? "/change-password" : "/account/security";
  return (
    <div className="space-y-1 border-t p-3">
      <Link
        href={href}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        {role === "STUDENT" ? t("changePassword") : t("signInSecurity")}
      </Link>
      <SupportLink role={role} />
      <ThemeSwitch />
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {t("signOut")}
      </button>
    </div>
  );
}

/** Fixed sidebar on tablets/desktops (md and up). */
export function Sidebar({ items, role, tenantName, logoUrl }: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-card md:flex">
      <div className="px-5 pb-2 pt-5">
        <Brand role={role} tenantName={tenantName} logoUrl={logoUrl} />
      </div>
      <NavLinks items={items} />
      <SignOutButton role={role} />
    </aside>
  );
}

/** Top bar + slide-in menu on phones (below md, down to 375px). */
export function MobileNav({ items, role, tenantName, logoUrl }: SidebarProps) {
  const t = useTranslations("nav");
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <header className="sticky top-0 z-40 flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
        <Brand role={role} tenantName={tenantName} logoUrl={logoUrl} />
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
                <Brand role={role} tenantName={tenantName} logoUrl={logoUrl} />
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
          <SignOutButton role={role} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
