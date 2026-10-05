import { redirect } from "next/navigation";
import { Role } from "@educore/db";
import { getSettingsForUser, getTenantForUser } from "@/lib/tenant";
import { getNavItemsForRole } from "@/lib/nav";
import { getEffectiveSession } from "@/lib/session";
import { MobileNav, Sidebar } from "@/components/layout/sidebar";
import { ImpersonationBanner } from "@/components/platform/impersonation-banner";

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

  const items = getNavItemsForRole(session.user.role);
  const settings = session.impersonation ? await getSettingsForUser(session.user.tenantId) : null;

  return (
    <>
      {session.impersonation && settings ? <ImpersonationBanner imp={session.impersonation} timeZone={settings.timezone} locale={settings.locale} /> : null}
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
