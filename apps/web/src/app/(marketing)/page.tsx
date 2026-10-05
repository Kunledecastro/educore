import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, ClipboardList, FileText, MessageSquare, ShieldCheck, Wallet } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@educore/ui/button";
import { getCurrentTenant } from "@/lib/tenant";

const HIGHLIGHTS = [
  { key: "attendance", icon: CalendarCheck },
  { key: "results", icon: ClipboardList },
  { key: "reportCards", icon: FileText },
  { key: "fees", icon: Wallet },
  { key: "messaging", icon: MessageSquare },
  { key: "safe", icon: ShieldCheck },
] as const;

/** EduCore's home page. On a school's own address it goes straight to that school's sign-in. */
export default async function MarketingHome() {
  if (await getCurrentTenant()) redirect("/login");
  const t = await getTranslations("marketing.home");
  return (
    <>
      <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 py-16 text-center sm:py-24">
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">{t("eyebrow")}</span>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{t("lead")}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">{t("ctaTrial")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/pricing">{t("ctaPricing")}</Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t("noCard")}</p>
      </section>

      <section aria-labelledby="what" className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 id="what" className="text-center text-2xl font-semibold">{t("whatTitle")}</h2>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {HIGHLIGHTS.map(({ key, icon: Icon }) => (
              <li key={key} className="rounded-lg border bg-card p-5">
                <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">{t(`highlights.${key}.title`)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(`highlights.${key}.body`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="how" className="mx-auto max-w-4xl px-4 py-16">
        <h2 id="how" className="text-center text-2xl font-semibold">{t("howTitle")}</h2>
        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {(["one", "two", "three"] as const).map((step, i) => (
            <li key={step} className="text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{t(`steps.${step}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`steps.${step}.body`)}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex justify-center">
          <Button asChild size="lg">
            <Link href="/signup">{t("ctaTrial")}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
