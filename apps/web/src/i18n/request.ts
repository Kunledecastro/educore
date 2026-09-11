import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// EduCore is localization-ready (architecture rule #5) via next-intl, but
// Phase 0 deliberately skips locale-prefixed routing: the URL's first path
// segment is reserved for tenant concerns (subdomain routing), not locale.
// Locale is instead a per-user preference stored in a cookie, same as theme.
export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export default getRequestConfig(async () => {
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value;
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(cookieLocale ?? "")
    ? (cookieLocale as Locale)
    : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
