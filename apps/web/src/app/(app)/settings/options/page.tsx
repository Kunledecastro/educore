import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/guard";
import { OptionsForm } from "./options-form";

export default async function OptionsPage() {
  const { db } = await requirePermission("academicSettings", "read");
  const t = await getTranslations("settings.options");
  const options = await db.academicSettings.findFirst();

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <OptionsForm
        initial={{
          showPosition: options?.showPosition ?? false,
          attendanceEditDays: String(options?.attendanceEditDays ?? 7),
        }}
      />
    </div>
  );
}
