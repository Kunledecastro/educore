import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getCurrentTenant } from "@/lib/tenant";
import { LoginForm } from "./login-form";

/** `?error=` codes we explain to the user. Anything else gets the generic message. */
const KNOWN_ERRORS = ["WrongSchool", "SessionRequired", "CredentialsSignin", "AccessDenied", "Configuration"] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

/** `?notice=` codes for good news (e.g. after setting a password from an invite). */
const KNOWN_NOTICES = ["PasswordSet"] as const;

export default async function LoginPage({ searchParams }: { searchParams: { error?: string | string[]; notice?: string | string[] } }) {
  const [tenant, t] = await Promise.all([getCurrentTenant(), getTranslations("login")]);
  const raw = Array.isArray(searchParams.error) ? searchParams.error[0] : searchParams.error;
  const errorKey: KnownError | "Unknown" | null = raw
    ? (KNOWN_ERRORS as readonly string[]).includes(raw)
      ? (raw as KnownError)
      : "Unknown"
    : null;

  const rawNotice = Array.isArray(searchParams.notice) ? searchParams.notice[0] : searchParams.notice;
  const notice = (KNOWN_NOTICES as readonly string[]).includes(rawNotice ?? "") ? (rawNotice as (typeof KNOWN_NOTICES)[number]) : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {tenant ? tenant.name : "EduCore"}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{t("title")}</h1>
        </div>
        {notice && !errorKey ? (
          <div role="status" className="flex gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <p>{t(`notices.${notice}`)}</p>
          </div>
        ) : null}
        {errorKey ? (
          <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{t(`errors.${errorKey}`)}</p>
          </div>
        ) : null}
        <LoginForm />
        {!tenant ? (
          <p className="text-center text-sm text-muted-foreground">
            {t("newSchool")}{" "}
            <Link href="/signup" className="font-medium text-foreground underline underline-offset-2">
              {t("startTrial")}
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}
