import {
  Building2,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  Megaphone,
  MessageSquare,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Icons the sidebar can show, looked up by name (see NavItem.icon). */
export const NAV_ICONS = {
  Building2,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  Megaphone,
  MessageSquare,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;
