import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, HeartPulse } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { HealthNotConfigured } from "@/components/health/not-configured";
import { PageHeader } from "@/components/page-header";
import { familyHealthList } from "@/lib/health/data";
import { healthPage } from "@/lib/health/page";

export const dynamic = "force-dynamic";

const VARIANT = { none: "outline", SUBMITTED: "warning", CHANGED: "warning", VERIFIED: "success" } as const;

/** Parents (Phase 7.0): each child and the state of their health profile. */
export default async function FamilyHealthPage() {
  const { viewer, configured } = await healthPage("read");
  if (viewer.role !== "PARENT") redirect("/clinic");
  const t = await getTranslations("health");
  const children = configured ? await familyHealthList(viewer) : [];
  return (
    <div className="space-y-6">
      <PageHeader title={t("family.title")} description={t("family.description")} />
      {!configured ? (
        <HealthNotConfigured />
      ) : children.length === 0 ? (
        <EmptyState icon={<HeartPulse className="h-8 w-8" aria-hidden="true" />} title={t("family.emptyTitle")} description={t("family.emptyDescription")} />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {children.map((c) => (
            <li key={c.id}>
              <Link href={`/health/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="font-medium">{c.name}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={VARIANT[c.status]}>{c.status === "none" ? t("family.notStarted") : t(`status.${c.status}`)}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("family.whoSees")}</p>
    </div>
  );
}
