import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/guard";
import { FeesTabs } from "./tabs";

/**
 * Fees (Phase 3). Fee setup (3.0) is for whoever can manage fee structures
 * (school admins, accountants); every page and action re-checks its own
 * permission. Families get their own fees view in 3.3.
 */
export default async function FeesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  if (ctx.isPlatformAdmin) redirect("/dashboard");
  if (!can(ctx.user.role, "feeStructure", "update")) return <>{children}</>;
  const t = await getTranslations("fees");
  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <FeesTabs />
      {children}
    </div>
  );
}
