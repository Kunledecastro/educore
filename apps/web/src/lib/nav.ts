import { Role } from "@educore/db";
import type { NavIconName } from "@/components/layout/nav-icons";

export interface NavItem {
  labelKey: string; // key into messages.nav
  href: string;
  // An icon NAME, not the component: NavItems are built on the server and
  // passed to the client <Sidebar>, and React can't serialise a component
  // (function) across that boundary. The sidebar maps names to icons.
  icon: NavIconName;
}

/**
 * Role-aware navigation, driven by the same permission matrix the API
 * routes enforce (@educore/auth) — a nav item is included only if the
 * role's PERMISSION_MATRIX grants at least `read` on the underlying
 * resource, so the UI can never dangle a link to a 403.
 */
export function getNavItemsForRole(role: Role): NavItem[] {
  const items: NavItem[] = [{ labelKey: "dashboard", href: "/dashboard", icon: "LayoutDashboard" }];

  if (role === Role.PLATFORM_ADMIN) {
    items.push(
      { labelKey: "platformTenants", href: "/platform/tenants", icon: "Building2" },
      { labelKey: "auditLog", href: "/audit-log", icon: "ShieldCheck" },
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
      { labelKey: "reportCards", href: "/report-cards", icon: "FileText" },
      { labelKey: "timetable", href: "/timetable", icon: "CalendarClock" },
      { labelKey: "announcements", href: "/announcements", icon: "Megaphone" },
      { labelKey: "fees", href: "/fees", icon: "Wallet" },
      { labelKey: "auditLog", href: "/audit-log", icon: "ShieldCheck" },
    );
  }

  if (role === Role.TEACHER) {
    items.push(
      { labelKey: "myStudents", href: "/students", icon: "Users" },
      { labelKey: "attendance", href: "/attendance", icon: "CalendarCheck" },
      { labelKey: "assessments", href: "/assessments", icon: "ClipboardList" },
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
      { labelKey: "auditLog", href: "/audit-log", icon: "ShieldCheck" },
    );
  }

  if (role === Role.PARENT) {
    items.push(
      { labelKey: "myChildren", href: "/students", icon: "Users" },
      { labelKey: "timetable", href: "/timetable", icon: "CalendarClock" },
      { labelKey: "fees", href: "/fees", icon: "Wallet" },
      { labelKey: "announcements", href: "/announcements", icon: "Megaphone" },
      { labelKey: "messages", href: "/messages", icon: "MessageSquare" },
    );
  }

  if (role === Role.STUDENT) {
    items.push(
      { labelKey: "timetable", href: "/timetable", icon: "CalendarClock" },
      { labelKey: "assessments", href: "/assessments", icon: "ClipboardList" },
      { labelKey: "announcements", href: "/announcements", icon: "Megaphone" },
    );
  }

  items.push({ labelKey: "settings", href: "/settings", icon: "Settings" });
  return items;
}
