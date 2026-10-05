import { getTranslations } from "next-intl/server";
import { getBranding } from "@/lib/branding-data";
import { requirePermission } from "@/lib/guard";
import { BrandingEditor } from "./branding-editor";

/** Settings → Branding: the school's logo, brand colour and the contact line on its documents. */
export default async function BrandingSettingsPage() {
  const { user } = await requirePermission("branding", "update", { page: true });
  const [current, t] = await Promise.all([getBranding(user.tenantId!), getTranslations("settings.branding")]);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <BrandingEditor
        schoolName={current?.name ?? ""}
        logoUrl={current?.logoUrl ?? null}
        primaryColor={current?.branding.primaryColor ?? ""}
        contactLine={current?.branding.contactLine ?? ""}
      />
    </div>
  );
}
