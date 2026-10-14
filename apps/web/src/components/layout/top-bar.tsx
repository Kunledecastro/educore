import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";

/** Morning / afternoon / evening in the school's time zone. */
export function partOfDay(timeZone: string, now: Date = new Date()): "morning" | "afternoon" | "evening" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/** "Good morning, Adaeze" — used as the dashboard's heading. */
export async function greeting(name: string, timeZone: string): Promise<string> {
  const t = await getTranslations("topBar");
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first ? t(`greeting.${partOfDay(timeZone)}`, { name: first }) : t(`greetingNoName.${partOfDay(timeZone)}`);
}

/**
 * Desktop top bar (Phase 9): today's date, and a quick pupil search for the
 * people who look pupils up all day. Phones keep the compact header from the
 * mobile menu.
 */
export async function TopBar({ timeZone, locale, search }: { timeZone: string; locale: string; search: boolean }) {
  const t = await getTranslations("topBar");
  const today = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone }).format(new Date());
  return (
    <div className="mb-6 hidden flex-wrap items-center gap-4 md:flex print:hidden">
      <p className="min-w-0 flex-1 text-sm font-medium text-muted-foreground">{today}</p>
      {search ? (
        <form action="/students" method="get" role="search" className="flex h-11 w-full max-w-sm items-center gap-2 rounded-full border bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="top-search" className="sr-only">
            {t("searchLabel")}
          </label>
          <input id="top-search" name="q" type="search" placeholder={t("searchPlaceholder")} className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </form>
      ) : null}
    </div>
  );
}
