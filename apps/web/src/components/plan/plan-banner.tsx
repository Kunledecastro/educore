import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Entitlements } from "@/lib/entitlements";

const DAY = 86_400_000;

/**
 * Subscription state at the top of every page (4.1). Admins see the trial
 * countdown; everyone sees grace and read-only, because those change what
 * they can do. Only admins get the link to act on it.
 */
export async function PlanBanner({ e, isAdmin, locale, now = new Date() }: { e: Entitlements; isAdmin: boolean; locale: string; now?: Date }) {
  const t = await getTranslations("plan.banner");
  const days = e.until ? Math.max(0, Math.ceil((e.until.getTime() - now.getTime()) / DAY)) : null;
  const date = e.until ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(e.until) : "";
  let text: string | null = null;
  let tone = "bg-muted text-foreground";
  if (e.state === "trial" && isAdmin) text = t("trial", { days: days ?? 0 });
  if (e.state === "grace") {
    text = isAdmin ? t("graceAdmin", { date }) : t("grace", { date });
    tone = "bg-warning text-warning-foreground";
  }
  if (e.state === "readOnly") {
    text = isAdmin ? t("readOnlyAdmin") : t("readOnly");
    tone = "bg-destructive text-destructive-foreground";
  }
  if (!text) return null;
  return (
    <div role="status" className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-sm font-medium print:hidden ${tone}`}>
      <span>{text}</span>
      {isAdmin ? (
        <Link href="/plan" className="underline underline-offset-2">
          {t("seePlan")}
        </Link>
      ) : null}
    </div>
  );
}
