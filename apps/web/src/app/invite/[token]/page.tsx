import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@educore/ui/button";
import { findPendingInvite } from "@/lib/invites";
import { SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

export const metadata = {
  // Invite links are secrets; keep them out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitePage({ params }: { params: { token: string } }) {
  const t = await getTranslations("invitePage");
  const invite = await findPendingInvite(params.token);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {invite ? (
          <>
            <div className="text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{invite.user.tenant?.name}</p>
              <h1 className="mt-1 text-xl font-semibold">{t("title", { name: invite.user.name })}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t("subtitle", { email: invite.user.email })}</p>
            </div>
            <SetPasswordForm token={params.token} email={invite.user.email} />
          </>
        ) : (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted" aria-hidden="true">
              <LinkIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-semibold">{t("invalidTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("invalidLink")}</p>
            <Link href="/login" className={buttonVariants({ variant: "outline" })}>
              {t("goToLogin")}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
