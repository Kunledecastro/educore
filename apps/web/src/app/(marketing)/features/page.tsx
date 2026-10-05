import Link from "next/link";
import { Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@educore/ui/button";

const SECTIONS = ["people", "attendance", "assessments", "reportCards", "timetable", "fees", "onlinePayments", "messaging", "platform"] as const;
const POINTS = ["a", "b", "c"] as const;

export async function generateMetadata() {
  const t = await getTranslations("marketing.features");
  return { title: `${t("title")} — EduCore` };
}

export default async function FeaturesPage() {
  const t = await getTranslations("marketing.features");
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">{t("lead")}</p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <section key={s} aria-labelledby={`f-${s}`} className="rounded-lg border bg-card p-6">
            <h2 id={`f-${s}`} className="text-lg font-semibold">{t(`sections.${s}.title`)}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {POINTS.map((p) => (
                <li key={p} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  <span>{t(`sections.${s}.${p}`)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="mt-12 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/signup">{t("cta")}</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/pricing">{t("seePricing")}</Link>
        </Button>
      </div>
    </div>
  );
}
