import { redirect } from "next/navigation";
import { Role } from "@educore/db";
import { getSettingsForUser, getTenantForUser } from "@/lib/tenant";
import { getNavItemsForRole } from "@/lib/nav";
import { getEffectiveSession } from "@/lib/session";
import { MobileNav, Sidebar } from "@/components/layout/sidebar";
import { ImpersonationBanner } from "@/components/platform/impersonation-banner";
import { PlanBanner } from "@/components/plan/plan-banner";
import { getEntitlements } from "@/lib/entitlements-server";
import { can } from "@educore/auth";
import { unreadThreadCount } from "@/lib/messaging/data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The effective user: normally the signed-in user; while support impersonates, the school admin.
  const session = await getEffectiveSession();
  if (!session) {
    redirect("/login");
  }

  const isPlatformAdmin = session.user.role === Role.PLATFORM_ADMIN;
  const { tenant, mismatch } = await getTenantForUser(session.user.tenantId ?? null);

  if (!isPlatformAdmin && mismatch) {
    redirect("/login?error=WrongSchool");
  }

  // The school's plan decides which modules appear (4.1); platform admins aren't on a plan.
  const entitlements = session.user.tenantId ? await getEntitlements(session.user.tenantId) : null;
  const unread =
    session.user.tenantId && entitlements?.modules.has("messaging") && can(session.user.role, "message", "read")
      ? await unreadThreadCount(session.user.tenantId, session.user.id)
      : 0;
  const items = getNavItemsForRole(session.user.role, entitlements?.modules ?? null).map((i) => (i.href === "/messages" && unread ? { ...i, badge: unread } : i));
  const settings = session.user.tenantId ? await getSettingsForUser(session.user.tenantId) : null;

  return (
    <>
      {session.impersonation && settings ? <ImpersonationBanner imp={session.impersonation} timeZone={settings.timezone} locale={settings.locale} /> : null}
      {entitlements && settings ? <PlanBanner e={entitlements} isAdmin={session.user.role === Role.SCHOOL_ADMIN} locale={settings.locale} /> : null}
      <div className="min-h-screen md:flex">
        <div className="contents print:hidden">
          <Sidebar items={items} role={session.user.role} tenantName={tenant?.name ?? null} />
        </div>
        <div className="contents print:hidden">
          <MobileNav items={items} role={session.user.role} tenantName={tenant?.name ?? null} />
        </div>
        <main id="main" className="min-w-0 flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </>
  );
}
