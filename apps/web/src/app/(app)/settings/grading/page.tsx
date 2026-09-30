import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/guard";
import { GradingEditor } from "./grading-editor";

export default async function GradingPage() {
  const { db } = await requirePermission("academicSettings", "read");
  const t = await getTranslations("settings.grading");
  const bands = await db.gradeBand.findMany({ orderBy: { minScore: "desc" } });

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <GradingEditor
        initial={bands.map((b) => ({ minScore: String(b.minScore), grade: b.grade, remark: b.remark ?? "" }))}
        isNew={bands.length === 0}
      />
    </div>
  );
}
