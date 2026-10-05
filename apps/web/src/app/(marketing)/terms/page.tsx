import { getTranslations } from "next-intl/server";

const PARTS = ["data", "isolation", "payments", "trial", "contact"] as const;

/**
 * Terms and privacy summary. DRAFT: a plain-language summary of how EduCore
 * actually works, to be replaced by terms reviewed by a lawyer before real
 * schools sign up (tracked in the Phase 4 status doc).
 */
export default async function TermsPage() {
  const t = await getTranslations("marketing.terms");
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p role="note" className="rounded-md border border-warning bg-warning/10 p-4 text-sm">{t("draft")}</p>
      {PARTS.map((p) => (
        <section key={p} aria-labelledby={`t-${p}`}>
          <h2 id={`t-${p}`} className="text-lg font-semibold">{t(`${p}.title`)}</h2>
          <p className="mt-2 text-muted-foreground">{t(`${p}.body`)}</p>
        </section>
      ))}
    </article>
  );
}
