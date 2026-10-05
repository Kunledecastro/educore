import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { SignupForm } from "./signup-form";

export async function generateMetadata() {
  const t = await getTranslations("signup");
  return { title: `${t("title")} — EduCore` };
}

/** Start a free trial (Phase 4.3). Signed-in people and a school's own address go to the app instead. */
export default async function SignupPage() {
  if (await getCurrentTenant()) redirect("/login");
  if ((await auth())?.user) redirect("/dashboard");
  const t = await getTranslations("signup");
  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "educore.app").split(",").map((d) => d.trim()).filter(Boolean).pop() ?? "educore.app";
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 md:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("lead")}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("points.trial")}</li>
          <li>{t("points.noCard")}</li>
          <li>{t("points.import")}</li>
          <li>{t("points.data")}</li>
        </ul>
        <p className="text-sm">
          {t("haveAccount")}{" "}
          <Link href="/login" className="font-medium underline underline-offset-2">
            {t("signIn")}
          </Link>
        </p>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <SignupForm rootDomain={rootDomain} />
      </div>
    </div>
  );
}
