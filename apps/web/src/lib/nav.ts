import { Role } from "@educore/db";
import type { NavIconName } from "@/components/layout/nav-icons";
import type { Module } from "./entitlements";

/** Pages that belong to a plan module (4.1): hidden when the school's plan doesn't include it. */
const MODULE_OF_HREF: Record<string, Module> = {
  "/attendance": "attendance",
  "/assessments": "assessments",
  "/report-cards": "reportCards",
  "/timetable": "timetable",
  "/fees": "fees",
  "/payments": "fees",
  "/announcements": "messaging",
  "/messages": "messaging",
  "/assignments": "assignments",
};

export interface NavItem {
  labelKey: string; // key into messages.nav
  href: string;
  // An icon NAME, not the component: NavItems are built on the server and
  // passed to the client <Sidebar>, and React can't serialise a component
  // (function) across that boundary. The sidebar maps names to icons.
  icon: NavIconName;
  /** A small count beside the label (e.g. unread messages). */
  badge?: number;
}

/**
 * Role-aware navigation, driven by the same permission matrix the API
 * routes enforce (@educore/auth) — a nav item is included only if the
 * role's PERMISSION_MATRIX grants at least `read` on the underlying
 * resource, so the UI can never dangle a link to a 403.
 */
export function getNavItemsForRole(role: Role, modules: ReadonlySet<Module> | null = null): NavItem[] {
  const items = navItemsForRole(role);
  if (!modules) return items;
  return items.filter((i) => {
    const m = MODULE_OF_HREF[i.href];
    return !m || modules.has(m);
  });
}

function navItemsForRole(role: Role): NavItem[] {
  const items: NavItem[] = [{ labelKey: "dashboard", href: "/dashboard", icon: "LayoutDashboard" }];

  if (role === Role.PLATFORM_ADMIN) {
    items.push(
      { labelKey: "platformTenants", href: "/platform/tenants", icon: "Building2" },
      { labelKey: "platformPlans", href: "/platform/plans", icon: "Layers" },
      { labelKey: "platformAudit", href: "/platform/audit", icon: "ShieldCheck" },
    );
    return items;
  }

  if (role === Role.SCHOOL_ADMIN) {
    items.push(
      { labelKey: "academics", href: "/academics", icon: "Library" },
      { labelKey: "students", href: "/students", icon: "Users" },
      { labelKey: "parents", href: "/parents", icon: "HeartHandshake" },
      { labelKey: "teachers", href: "/teachers", icon: "GraduationCap" },
      { labelKey: "staff", href: "/staff", icon: "Briefcase" },
      { labelKey: "imports", href: "/imports", icon: "FileUp" },
      { labelKey: "attendance", href: "/attendance", icon: "CalendarCheck" },
      { labelKey: "assessments", href: "/assessments", icon: "ClipboardList" },
      { labelKey: "assignments", href: "/assignments", icon: "NotebookPen" },
      { labelKey: "reportCards", href: "/report-cards", icon: "FileText" },
      { labelKey: "timetable", href: "/timetable", icon: "CalendarClock" },
      { labelKey: "announcements", href: "/announcements", icon: "Megaphone" },
      { labelKey: "messages", href: "/messages", icon: "MessageSquare" },
      { labelKey: "fees", href: "/fees", icon: "Wallet" },
      { labelKey: "payments", href: "/payments", icon: "Receipt" },
      { labelKey: "auditLog", href: "/audit-log", icon: "ShieldCheck" },
      { labelKey: "plan", href: "/plan", icon: "BadgeCheck" },
    );
  }

  if (role === Role.TEACHER) {
    items.push(
      { labelKey: "myStudents", href: "/students", icon: "Users" },
      { labelKey: "attendance", href: "/attendance", icon: "CalendarCheck" },
      { labelKey: "assessments", href: "/assessments", icon: "ClipboardList" },
      { labelKey: "assignments", href: "/assignments", icon: "NotebookPen" },
      { labelKey: "reportCards", href: "/report-cards", icon: "FileText" },
      { labelKey: "timetable", href: "/timetable", icon: "CalendarClock" },
      { labelKey: "announcements", href: "/announcements", icon: "Megaphone" },
      { labelKey: "messages", href: "/messages", icon: "MessageSquare" },
    );
  }

  if (role === Role.ACCOUNTANT) {
    items.push(
      { labelKey: "students", href: "/students", icon: "Users" },
      { labelKey: "fees", href: "/fees", icon: "Wallet" },
      { labelKey: "payments", href: "/payments", icon: "Receipt" },
      { labelKey: "announcements", href: "/announcements", icon: "Megaphone" },
      { labelKey: "auditLog", href: "/audit-log", icon: "ShieldCheck" },
    );
  }

  if (role === Role.PARENT) {
    items.push(
      { labelKey: "myChildren", href: "/students", icon: "Users" },
      { labelKey: "assignments", href: "/assignments", icon: "NotebookPen" },
      { labelKey: "timetable", href: "/timetable", icon: "CalendarClock" },
      { labelKey: "fees", href: "/fees", icon: "Wallet" },
      { labelKey: "announcements", href: "/announcements", icon: "Megaphone" },
      { labelKey: "messages", href: "/messages", icon: "MessageSquare" },
    );
  }

  if (role === Role.STUDENT) {
    items.push(
      { labelKey: "assignments", href: "/assignments", icon: "NotebookPen" },
      { labelKey: "timetable", href: "/timetable", icon: "CalendarClock" },
      { labelKey: "assessments", href: "/assessments", icon: "ClipboardList" },
      { labelKey: "announcements", href: "/announcements", icon: "Megaphone" },
    );
  }

  items.push({ labelKey: "settings", href: "/settings", icon: "Settings" });
  return items;
}
