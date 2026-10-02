import { redirect } from "next/navigation";
import { Role } from "@educore/db";
import { auth } from "@/lib/auth";
import { getTenantForUser } from "@/lib/tenant";
import { getNavItemsForRole } from "@/lib/nav";
import { MobileNav, Sidebar } from "@/components/layout/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const isPlatformAdmin = session.user.role === Role.PLATFORM_ADMIN;
  const { tenant, mismatch } = await getTenantForUser(session.user.tenantId ?? null);

  if (!isPlatformAdmin && mismatch) {
    redirect("/login?error=WrongSchool");
  }

  const items = getNavItemsForRole(session.user.role);

  return (
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
  );
}
