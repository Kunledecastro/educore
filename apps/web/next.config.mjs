import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Assignment files upload straight from the browser to Supabase Storage
// (Phase 5.1). Allow Supabase hosts as connect targets — statically, so it
// never depends on SUPABASE_URL being present at build time — plus the exact
// configured origin if it's somewhere else (e.g. a custom domain).
function storageOrigins() {
  const out = ["https://*.supabase.co"];
  try {
    const o = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "";
    if (o && !o.endsWith(".supabase.co")) out.push(o);
  } catch {
    /* ignore a malformed URL */
  }
  return out.join(" ");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@educore/db", "@educore/auth", "@educore/ui"],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "@node-rs/argon2", "exceljs", "@react-pdf/renderer"],
    // Report-card PDFs embed Noto Sans (lib/report-card-pdf.tsx); ship the font files with those routes.
    outputFileTracingIncludes: {
      "/api/report-cards/**": ["./assets/fonts/**"],
      "/api/invoices/**": ["./assets/fonts/**"],
      "/api/receipts/**": ["./assets/fonts/**"],
    },
    // CSV uploads go through a Server Action: 2 MB file limit + form overhead.
    serverActions: { bodySizeLimit: "3mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              `connect-src 'self' ${storageOrigins()}`,
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
