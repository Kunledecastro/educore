import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@educore/ui/button";
import { loadPlans } from "@/lib/entitlements-data";
import { formatMoney } from "@/lib/format";
import { CountUp } from "@/components/marketing/motion";
import { SCREENSHOTS } from "@/lib/marketing-screens";
import { TESTIMONIALS } from "@/lib/marketing-testimonials";
import { SUPPORT, whatsappLink } from "@/lib/support";
import { getCurrentTenant } from "@/lib/tenant";


/** The lowest per-pupil monthly price of any public paid plan, in minor units. */
async function fromPrice(): Promise<number | null> {
  try {
    const prices = (await loadPlans()).filter((p) => p.isPublic && p.priceMinor > 0).map((p) => p.priceMinor);
    return prices.length ? Math.min(...prices) : null;
  } catch {
    return null;
  }
}

/**
 * Hero photo: Emmanuel Ikwuegbu on Unsplash (free under the Unsplash licence,
 * credited anyway). Served from Unsplash's image CDN, which resizes it per
 * screen; the CSP already allows https images.
 */
const HERO_PHOTO = "https://images.unsplash.com/photo-1632215861513-130b66fe97f4";
const HERO_PHOTO_PAGE = "https://unsplash.com/photos/a-woman-standing-in-front-of-a-group-of-children-VC6MGt9ZoBA";
const heroSrc = (w: number) => `${HERO_PHOTO}?auto=format&fit=crop&w=${w}&h=${Math.round((w * 5) / 4)}&q=75`;

function HeroPhoto({ alt, credit }: { alt: string; credit: string }) {
  return (
    <figure style={{ "--d": "220ms" } as React.CSSProperties} className="motion-rise relative mx-auto w-full max-w-sm pr-3 pt-3 sm:max-w-md sm:pr-4 sm:pt-4 lg:max-w-none">
      <div aria-hidden="true" className="motion-drift absolute bottom-6 left-3 right-0 top-0 -z-10 rounded-[28px] bg-harmattan sm:left-4" />
      {/* eslint-disable-next-line @next/next/no-img-element -- responsive srcset from Unsplash's CDN */}
      <img
        src={heroSrc(800)}
        srcSet={[480, 800, 1200].map((w) => `${heroSrc(w)} ${w}w`).join(", ")}
        sizes="(min-width: 1024px) 40vw, (min-width: 640px) 28rem, 100vw"
        width={800}
        height={1000}
        alt={alt}
        fetchPriority="high"
        className="motion-float block aspect-[4/5] h-auto w-full rounded-[28px] object-cover shadow-2xl"
      />
      <figcaption className="mt-2 text-right text-xs text-muted-foreground">
        <a href={HERO_PHOTO_PAGE} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
          {credit}
        </a>
      </figcaption>
    </figure>
  );
}

/** EduCore's home page (Phase 9.2, Harmattan Gold). On a school's own address it goes straight to that school's sign-in. */
export default async function MarketingHome() {
  if (await getCurrentTenant()) redirect("/login");
  const [t, tc, price] = await Promise.all([getTranslations("marketing.home"), getTranslations("marketing.contact"), fromPrice()]);
  const priceText = price === null ? null : formatMoney(price / 100, { locale: "en-NG", currency: "NGN", timezone: "Africa/Lagos", dateStyle: "medium" });
  const wa = SUPPORT.whatsapp ? whatsappLink(SUPPORT.whatsapp, tc("whatsappMessage")) : null;

  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-10 pt-14 sm:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <div className="min-w-0">
            <p style={{ "--d": "0ms" } as React.CSSProperties} className="motion-rise mb-5 inline-flex rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-primary">{t("eyebrow")}</p>
            <h1 style={{ "--d": "90ms" } as React.CSSProperties} className="motion-rise text-4xl font-extrabold leading-[1.04] tracking-tight sm:text-6xl">{t("title")}</h1>
            <p style={{ "--d": "180ms" } as React.CSSProperties} className="motion-rise mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">{t("lead")}</p>
            <div style={{ "--d": "270ms" } as React.CSSProperties} className="motion-rise mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/signup">{t("ctaTrial")}</Link>
              </Button>
              {wa ? (
                <Button asChild size="lg" variant="outline">
                  <a href={wa} target="_blank" rel="noopener noreferrer">
                    {t("ctaWhatsApp")}
                  </a>
                </Button>
              ) : (
                <Button asChild size="lg" variant="outline">
                  <Link href="/pricing">{t("ctaPricing")}</Link>
                </Button>
              )}
            </div>
            <p style={{ "--d": "340ms" } as React.CSSProperties} className="motion-rise mt-3 text-sm text-muted-foreground">{t("noCard")}</p>
          </div>
          <HeroPhoto alt={t("heroPhotoAlt")} credit={t("heroPhotoCredit")} />
        </div>

        {/* Product shot: a real screenshot when we have one, otherwise an illustration of the dashboard. */}
        <div data-reveal className="motion-drift mt-12 overflow-hidden rounded-[28px] bg-harmattan px-4 pt-6 sm:px-10 sm:pt-10">
          {SCREENSHOTS[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- static, same-origin, sized
            <img src={SCREENSHOTS[0].src} width={SCREENSHOTS[0].width} height={SCREENSHOTS[0].height} alt={t(`screens.${SCREENSHOTS[0].key}.alt`)} className="block h-auto w-full rounded-t-2xl shadow-2xl" />
          ) : (
            <DashboardIllustration t={t} />
          )}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">{SCREENSHOTS[0] ? t("demoNote") : t("illustrationNote")}</p>
      </section>

      {/* Bento of what it does */}
      <section aria-labelledby="bento" className="mx-auto max-w-6xl px-4 py-16">
        <h2 id="bento" data-reveal className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          {t("bentoTitle")}
          <span className="block text-muted-foreground">{t("bentoSub")}</span>
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <article data-reveal style={{ "--d": "0ms" } as React.CSSProperties} className="motion-lift flex flex-col gap-6 rounded-3xl bg-secondary p-7 md:col-span-2 md:flex-row md:items-center">
            <div className="flex-1">
              <h3 className="text-2xl font-bold tracking-tight">{t("bento.register.title")}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{t("bento.register.body")}</p>
            </div>
            <ul aria-hidden="true" className="flex flex-1 flex-col gap-2 rounded-2xl bg-card p-4 text-sm shadow-sm">
              {[
                ["Chiamaka O.", true],
                ["Tobi A.", false],
                ["Aisha B.", true],
              ].map(([n, here]) => (
                <li key={n as string} className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{n}</span>
                  <span className="flex gap-1.5">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${here ? "bg-ink text-ink-foreground" : "border"}`}>{t("bento.register.present")}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${!here ? "bg-warning text-warning-foreground" : "border"}`}>{t("bento.register.late")}</span>
                  </span>
                </li>
              ))}
            </ul>
          </article>

          <article data-reveal style={{ "--d": "100ms" } as React.CSSProperties} className="motion-lift motion-drift flex flex-col justify-between gap-6 rounded-3xl bg-harmattan-soft p-7">
            <div>
              <h3 className="text-2xl font-bold tracking-tight">{t("bento.fees.title")}</h3>
              <p className="mt-2 leading-relaxed text-foreground/80">{t("bento.fees.body")}</p>
            </div>
            <div aria-hidden="true" className="flex items-center justify-between rounded-2xl bg-card p-4 text-sm">
              <span>
                <span className="block text-xs text-muted-foreground">{t("bento.fees.receipt")}</span>
                <b>{t("bento.fees.received")}</b>
              </span>
              <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-bold text-success">{t("bento.fees.paid")}</span>
            </div>
          </article>

          <article data-reveal style={{ "--d": "200ms" } as React.CSSProperties} className="motion-lift flex flex-col justify-between gap-6 rounded-3xl bg-secondary p-7">
            <div>
              <h3 className="text-2xl font-bold tracking-tight">{t("bento.reports.title")}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{t("bento.reports.body")}</p>
            </div>
            <div aria-hidden="true" className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1.5 rounded-2xl bg-card p-4 text-sm">
              <span className="text-muted-foreground">{t("bento.reports.subject")}</span>
              <span className="text-muted-foreground">{t("bento.reports.score")}</span>
              <span className="text-muted-foreground">{t("bento.reports.grade")}</span>
              <span>Mathematics</span>
              <b>78</b>
              <b>A</b>
              <span>English</span>
              <b>71</b>
              <b>B</b>
            </div>
          </article>

          <article data-reveal style={{ "--d": "0ms" } as React.CSSProperties} className="motion-lift flex flex-col justify-between gap-6 rounded-3xl bg-secondary p-7">
            <div>
              <h3 className="text-2xl font-bold tracking-tight">{t("bento.parents.title")}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{t("bento.parents.body")}</p>
            </div>
            <div aria-hidden="true" className="flex flex-col gap-2 text-sm">
              <span className="max-w-[85%] self-start rounded-2xl rounded-bl-md border bg-card px-4 py-2.5">{t("bento.parents.msgTeacher")}</span>
              <span className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-ink-foreground">{t("bento.parents.msgParent")}</span>
            </div>
          </article>

          <article data-reveal style={{ "--d": "100ms" } as React.CSSProperties} className="motion-lift flex flex-col justify-between gap-6 rounded-3xl bg-ink p-7 text-ink-foreground">
            <div>
              <h3 className="text-2xl font-bold tracking-tight">{t("bento.safe.title")}</h3>
              <p className="mt-2 leading-relaxed opacity-80">{t("bento.safe.body")}</p>
            </div>
            <ul className="flex flex-wrap gap-2 text-xs font-semibold">
              {(["twoFactor", "approvals", "audit"] as const).map((k) => (
                <li key={k} className="rounded-full border border-current/30 px-3 py-1.5 opacity-90">
                  {t(`bento.safe.tags.${k}`)}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      {/* Big numbers (facts, not claims) */}
      <section aria-labelledby="numbers" className="mx-auto max-w-6xl px-4 pb-16">
        <h2 id="numbers" data-reveal className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          {t("numbersTitle")}
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div data-reveal style={{ "--d": "0ms" } as React.CSSProperties} className="motion-lift motion-drift flex min-h-56 flex-col justify-between rounded-3xl bg-harmattan p-7">
            <CountUp text={t("numbers.trial.value")} className="text-6xl font-extrabold tracking-tighter" />
            <p className="leading-relaxed text-foreground/80">{t("numbers.trial.body")}</p>
          </div>
          <div data-reveal style={{ "--d": "120ms" } as React.CSSProperties} className="motion-lift motion-drift flex min-h-56 flex-col justify-between rounded-3xl bg-harmattan-soft p-7">
            <CountUp text={t("numbers.tap.value")} className="text-6xl font-extrabold tracking-tighter" />
            <p className="leading-relaxed text-foreground/80">{t("numbers.tap.body")}</p>
          </div>
          <div data-reveal style={{ "--d": "240ms" } as React.CSSProperties} className="motion-lift flex min-h-56 flex-col justify-between rounded-3xl bg-ink p-7 text-ink-foreground">
            <CountUp text={priceText ? t("numbers.price.value", { price: priceText }) : t("numbers.price.fallback")} className="text-5xl font-extrabold tracking-tighter" />
            <p className="leading-relaxed opacity-80">
              {t("numbers.price.body")}{" "}
              <Link href="/pricing" className="font-semibold underline underline-offset-4">
                {t("ctaPricing")}
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* Screenshots (when we have real ones) */}
      {SCREENSHOTS.length > 1 ? (
        <section aria-labelledby="see" className="mx-auto max-w-6xl px-4 pb-16">
          <h2 id="see" data-reveal className="text-3xl font-extrabold tracking-tight">{t("seeTitle")}</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t("seeLead")}</p>
          <ul className="mt-8 grid gap-6 md:grid-cols-2">
            {SCREENSHOTS.slice(1).map((s) => (
              <li key={s.src}>
                <figure data-reveal className="motion-lift overflow-hidden rounded-3xl border bg-card">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static, same-origin, sized */}
                  <img src={s.src} width={s.width} height={s.height} alt={t(`screens.${s.key}.alt`)} loading="lazy" className="h-auto w-full" />
                  <figcaption className="border-t p-5">
                    <span className="font-bold">{t(`screens.${s.key}.title`)}</span>
                    <span className="block text-sm text-muted-foreground">{t(`screens.${s.key}.body`)}</span>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* How it works */}
      <section aria-labelledby="how" className="bg-secondary">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 id="how" data-reveal className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("howTitle")}</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {(["one", "two", "three"] as const).map((step, i) => (
              <li key={step} data-reveal style={{ "--d": `${i * 120}ms` } as React.CSSProperties} className="motion-lift rounded-3xl bg-card p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink font-bold text-ink-foreground">{i + 1}</span>
                <h3 className="mt-4 text-lg font-bold">{t(`steps.${step}.title`)}</h3>
                <p className="mt-1 leading-relaxed text-muted-foreground">{t(`steps.${step}.body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Real quotes only */}
      {TESTIMONIALS.length ? (
        <section aria-labelledby="quotes" className="mx-auto max-w-6xl px-4 py-16">
          <h2 id="quotes" className="sr-only">{t("quotesTitle")}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {TESTIMONIALS.map((q) => (
              <figure key={q.name} data-reveal className="rounded-3xl border bg-card p-7">
                <blockquote className="text-xl font-semibold leading-snug">“{q.quote}”</blockquote>
                <figcaption className="mt-4 text-sm text-muted-foreground">
                  {q.name}, {q.role} · {q.school}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {/* Call to action */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div data-reveal className="motion-drift flex flex-wrap items-center justify-between gap-6 rounded-[28px] bg-harmattan p-8 sm:p-12">
          <div className="flex-[1_1_24rem]">
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{t("ctaBandTitle")}</h2>
            <p className="mt-2 text-lg text-foreground/80">{t("ctaBandBody")}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/signup">{t("ctaTrialShort")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              {wa ? (
                <a href={wa} target="_blank" rel="noopener noreferrer">
                  {t("ctaDemo")}
                </a>
              ) : (
                <Link href="/contact">{t("ctaContact")}</Link>
              )}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

/** A drawn (not screenshotted) dashboard for the hero, until real screenshots are added. Decorative: described by its caption. */
function DashboardIllustration({ t }: { t: (k: string) => string }) {
  return (
    <div aria-hidden="true" className="flex min-h-80 overflow-hidden rounded-t-2xl bg-card text-foreground shadow-2xl">
      <div className="hidden w-48 shrink-0 flex-col gap-1 border-r p-4 text-sm text-muted-foreground sm:flex">
        <div className="mb-3 flex items-center gap-2 font-bold text-foreground">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-[11px] text-primary-foreground">GA</span>
          Greenfield
        </div>
        {["overview", "attendance", "results", "fees", "messages"].map((k, i) => (
          <span key={k} className={`rounded-lg px-2.5 py-2 ${i === 0 ? "bg-accent font-semibold text-foreground" : ""}`}>
            {t(`illustration.nav.${k}`)}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-xl bg-harmattan-soft p-3">
            <span className="block text-xs text-foreground/80">{t("illustration.present")}</span>
            <b className="text-2xl font-extrabold">94%</b>
          </div>
          <div className="rounded-xl border p-3">
            <span className="block text-xs text-muted-foreground">{t("illustration.fees")}</span>
            <b className="text-2xl font-extrabold">71%</b>
          </div>
          <div className="hidden rounded-xl bg-ink p-3 text-ink-foreground lg:block">
            <span className="block text-xs opacity-80">{t("illustration.registers")}</span>
            <b className="text-2xl font-extrabold">14 / 16</b>
          </div>
        </div>
        <svg viewBox="0 0 400 110" className="h-28 w-full text-primary">
          <path d="M0 70 L50 58 L100 62 L150 46 L200 52 L250 36 L300 42 L350 28 L400 32 L400 110 L0 110 Z" fill="currentColor" opacity="0.15" />
          <path d="M0 70 L50 58 L100 62 L150 46 L200 52 L250 36 L300 42 L350 28 L400 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
