import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/guard";
import { ScoresEditor } from "./scores-editor";

export default async function ScoresPage() {
  const { db } = await requirePermission("academicSettings", "read");
  const t = await getTranslations("settings.scores");
  const components = await db.assessmentType.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: { _count: { select: { assessments: true } } },
  });

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <ScoresEditor
        isNew={components.length === 0}
        initial={components.map((c) => ({ id: c.id, name: c.name, weight: String(c.weight), inUse: c._count.assessments > 0 }))}
      />
    </div>
  );
}
