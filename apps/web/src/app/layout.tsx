import type { Metadata } from "next";
import { getLocale, getMessages, getTimeZone } from "next-intl/server";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "EduCore — School Management System",
  description: "Multi-tenant school management SaaS.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // School branding is applied by the app layout and the school's sign-in page (BrandStyle),
  // not here: the public EduCore site keeps EduCore's own look.
  const [locale, messages, timeZone] = await Promise.all([getLocale(), getMessages(), getTimeZone()]);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <Providers locale={locale} messages={messages} timeZone={timeZone}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
