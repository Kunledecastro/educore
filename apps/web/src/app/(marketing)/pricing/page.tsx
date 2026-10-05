import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@educore/ui/button";
import { PLATFORM_FORMAT } from "@/components/platform/display";
import { MODULES } from "@/lib/entitlements";
import { loadPlans } from "@/lib/entitlements-data";
import { formatMoney, formatNumber } from "@/lib/format";
import { PriceEstimator } from "./price-estimator";

// Prices come from the plan catalogue the platform team edits — read on each request (never at build time).
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("marketing.pricing");
  return { title: `${t("title")} — EduCore` };
}

export default async function PricingPage() {
  const [all, t, tm] = await Promise.all([loadPlans(), getTranslations("marketing.pricing"), getTranslations("plan.modules")]);
  const plans = all.filter((p) => p.isPublic && p.code !== "FREE_TRIAL" && p.priceMinor > 0);
  const trial = all.find((p) => p.code === "FREE_TRIAL");
  const fmt = PLATFORM_FORMAT;

  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-center text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">{t("lead")}</p>
      <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted-foreground">
        {t("trial", { max: trial?.maxStudents ? formatNumber(trial.maxStudents, fmt) : "—" })}
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {plans.map((p) => (
          <section key={p.code} aria-labelledby={`p-${p.code}`} className="flex flex-col rounded-lg border bg-card p-6">
            <h2 id={`p-${p.code}`} className="text-lg font-semibold">{p.name}</h2>
            <p className="mt-3 text-3xl font-bold">{formatMoney(p.priceMinor / 100, fmt)}</p>
            <p className="text-sm text-muted-foreground">{t("perStudent")}</p>
            <p className="mt-4 text-sm font-medium">{p.maxStudents === null ? t("unlimited") : t("upTo", { max: formatNumber(p.maxStudents, fmt) })}</p>
            <ul className="mt-4 flex-1 space-y-1 text-sm">
              <li>{t("core")}</li>
              {MODULES.filter((m) => p.modules.includes(m)).map((m) => (
                <li key={m}>{tm(m)}</li>
              ))}
            </ul>
            <Button asChild className="mt-6">
              <Link href="/signup">{t("cta")}</Link>
            </Button>
          </section>
        ))}
      </div>

      <PriceEstimator plans={plans.map((p) => ({ code: p.code, name: p.name, priceMinor: p.priceMinor, maxStudents: p.maxStudents }))} />

      <section aria-labelledby="faq" className="mx-auto mt-16 max-w-3xl">
        <h2 id="faq" className="text-xl font-semibold">{t("faqTitle")}</h2>
        <dl className="mt-4 space-y-4">
          {(["counted", "trial", "change", "pay", "stop"] as const).map((q) => (
            <div key={q}>
              <dt className="font-medium">{t(`faq.${q}.q`)}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{t(`faq.${q}.a`)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
