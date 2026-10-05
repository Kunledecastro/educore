import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@educore/ui/button";

/** Public site (Phase 4.3): header with the main links, footer. No session needed. */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("marketing.nav");
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2">
        {t("skip")}
      </a>
      <header className="border-b">
        <nav aria-label={t("label")} className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-bold tracking-tight">
            EduCore
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/features" className="text-muted-foreground hover:text-foreground">
              {t("features")}
            </Link>
            <Link href="/pricing" className="text-muted-foreground hover:text-foreground">
              {t("pricing")}
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">{t("signIn")}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">{t("startTrial")}</Link>
            </Button>
          </div>
        </nav>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} EduCore</span>
          <Link href="/features" className="hover:text-foreground">{t("features")}</Link>
          <Link href="/pricing" className="hover:text-foreground">{t("pricing")}</Link>
          <Link href="/terms" className="hover:text-foreground">{t("terms")}</Link>
        </div>
      </footer>
    </div>
  );
}
