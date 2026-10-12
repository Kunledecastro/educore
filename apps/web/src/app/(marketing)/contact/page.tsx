import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@educore/ui/button";
import { SUPPORT, telLink, whatsappLink } from "@/lib/support";

const FAQ = ["signIn", "trial", "import", "data", "parents"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.contact");
  return { title: t("metaTitle") };
}

/** Contact and help (tester review, Oct 2026): school owners like to talk to a person first. */
export default async function ContactPage() {
  const t = await getTranslations("marketing.contact");
  const { whatsapp, email, phone } = SUPPORT;
  const any = Boolean(whatsapp || email || phone);
  return (
    <div className="mx-auto max-w-4xl space-y-12 px-4 py-16">
      <header className="space-y-3 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">{t("lead")}</p>
      </header>

      <section aria-labelledby="c-ways">
        <h2 id="c-ways" className="sr-only">
          {t("waysTitle")}
        </h2>
        {any ? (
          <ul className="grid gap-4 sm:grid-cols-3">
            {whatsapp ? (
              <li className="flex flex-col rounded-lg border bg-card p-5">
                <MessageCircle className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">{t("whatsappTitle")}</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">{t("whatsappBody")}</p>
                <Button asChild className="mt-4">
                  <a href={whatsappLink(whatsapp, t("whatsappMessage"))} target="_blank" rel="noopener noreferrer">
                    {t("whatsappCta")}
                  </a>
                </Button>
              </li>
            ) : null}
            {phone ? (
              <li className="flex flex-col rounded-lg border bg-card p-5">
                <Phone className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">{t("phoneTitle")}</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">{t("phoneBody")}</p>
                <Button asChild variant="outline" className="mt-4">
                  <a href={telLink(phone)}>{phone}</a>
                </Button>
              </li>
            ) : null}
            {email ? (
              <li className="flex flex-col rounded-lg border bg-card p-5">
                <Mail className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">{t("emailTitle")}</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">{t("emailBody")}</p>
                <Button asChild variant="outline" className="mt-4">
                  <a href={`mailto:${email}`} className="break-all">
                    {email}
                  </a>
                </Button>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="rounded-md border p-4 text-center text-sm text-muted-foreground">{t("noneYet")}</p>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">{t("schoolUsers")}</p>
      </section>

      <section aria-labelledby="c-faq" id="help" className="space-y-4">
        <h2 id="c-faq" className="text-2xl font-semibold">
          {t("faqTitle")}
        </h2>
        <div className="divide-y rounded-lg border">
          {FAQ.map((q) => (
            <details key={q} className="group p-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t(`faq.${q}.q`)}
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">{t(`faq.${q}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/signup">{t("ctaTrial")}</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/pricing">{t("ctaPricing")}</Link>
        </Button>
      </div>
    </div>
  );
}
