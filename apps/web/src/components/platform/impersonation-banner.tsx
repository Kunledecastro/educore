import { getTranslations } from "next-intl/server";
import type { Impersonation } from "@/lib/impersonation";
import { StopImpersonationButton } from "./stop-impersonation-button";

/** Always visible while support is working as a school admin. Never silent. */
export async function ImpersonationBanner({ imp, timeZone, locale }: { imp: Impersonation; timeZone: string; locale: string }) {
  const t = await getTranslations("platform.impersonation");
  const until = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(imp.expiresAt);
  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-warning px-4 py-2 text-center text-sm font-medium text-warning-foreground print:hidden">
      <span>{t("banner", { name: imp.target.name, school: imp.target.tenantName, until })}</span>
      <StopImpersonationButton />
    </div>
  );
}
