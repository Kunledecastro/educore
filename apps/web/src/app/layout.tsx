import type { Metadata } from "next";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { getCurrentTenant } from "@/lib/tenant";
import "./globals.css";

export const metadata: Metadata = {
  title: "EduCore — School Management System",
  description: "Multi-tenant school management SaaS.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages, tenant] = await Promise.all([getLocale(), getMessages(), getCurrentTenant()]);

  const branding = (tenant?.branding as { primaryColor?: string } | null) ?? null;

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className="min-h-screen font-sans antialiased"
        style={branding?.primaryColor ? ({ "--tenant-primary": branding.primaryColor } as React.CSSProperties) : undefined}
      >
        <Providers locale={locale} messages={messages}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
