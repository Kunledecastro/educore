import { Construction } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@educore/ui/empty-state";
import { PageHeader } from "@/components/page-header";

export type RoadmapPhase = "phase1" | "phase2" | "phase3" | "phase4";

/** Honest placeholder for a sidebar area that exists on the roadmap but isn't built yet. */
export async function ComingSoon({ navKey, phase }: { navKey: string; phase: RoadmapPhase }) {
  const [tNav, t] = await Promise.all([getTranslations("nav"), getTranslations("comingSoon")]);
  const title = tNav(navKey);
  return (
    <div>
      <PageHeader title={title} />
      <EmptyState
        icon={<Construction className="h-6 w-6" />}
        title={t("title", { area: title })}
        description={t(`phases.${phase}`)}
      />
    </div>
  );
}
