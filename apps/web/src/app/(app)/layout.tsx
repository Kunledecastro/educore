import { redirect } from "next/navigation";
import { Role } from "@educore/db";
import { auth } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { getNavItemsForRole } from "@/lib/nav";
import { Sidebar } from "@/components/layout/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const tenant = await getCurrentTenant();
  const isPlatformAdmin = session.user.role === Role.PLATFORM_ADMIN;

  if (!isPlatformAdmin && (!tenant || tenant.id !== session.user.tenantId)) {
    redirect("/login?error=WrongSchool");
  }

  const items = getNavItemsForRole(session.user.role);

  return (
    <div className="flex">
      <Sidebar items={items} role={session.user.role} tenantName={tenant?.name ?? null} />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
