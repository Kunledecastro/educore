import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { securityOverview } from "@/lib/security/two-factor";
import { getSettingsForUser } from "@/lib/tenant";
import { SecurityControls } from "./controls";

/** Account → Sign-in security (Phase 6.0): two-factor sign-in for this person. */
export default async function AccountSecurityPage() {
  const ctx = await requireUser();
  // While support works as a school admin, this page is about the real person, not the admin being impersonated.
  if (ctx.impersonation) redirect("/dashboard");
  const [o, t, settings] = await Promise.all([securityOverview(ctx.user.id), getTranslations("twoFactor.account"), getSettingsForUser(ctx.user.tenantId ?? null)]);
  if (!o) redirect("/login");
  if (!o.offered) redirect("/change-password");
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>{t("twoFactor")}</CardTitle>
          <Badge variant={o.enabled ? "success" : o.required ? "destructive" : "secondary"}>{o.enabled ? t("on") : t("off")}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("explain")}</p>
          {o.enabled ? (
            <p className="text-sm">
              {o.enabledAt ? t("since", { when: formatDateTime(o.enabledAt, settings) }) : null} {t("backupLeft", { count: o.backupLeft })}
            </p>
          ) : null}
          {o.required ? <p className="text-sm text-muted-foreground">{t("requiredForRole")}</p> : null}
          <SecurityControls enabled={o.enabled} required={o.required} lowBackup={o.enabled && o.backupLeft <= 3} />
        </CardContent>
      </Card>
    </div>
  );
}
