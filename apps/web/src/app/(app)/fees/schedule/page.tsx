import Link from "next/link";
import { CalendarRange, Coins } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { ComingSoon } from "@/components/coming-soon";
import { ParamSelect } from "@/components/list/param-select";
import { feeTerms, loadSchedule } from "@/lib/fees-data";
import { requireModule } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { CopyScheduleButton } from "./copy-schedule";
import { ScheduleEditor } from "./schedule-editor";

/** The fee schedule: what each class pays per item for a term (milestone 3.0). */
export default async function FeeSchedulePage({ searchParams }: { searchParams: { term?: string | string[] } }) {
  const ctx = await requireModule("fees");
  if (!can(ctx.user.role, "feeStructure", "read")) return <ComingSoon navKey="fees" phase="phase3" />;
  const { user, db } = ctx;
  const [t, settings] = await Promise.all([getTranslations("fees.schedule"), getSettingsForUser(user.tenantId ?? null)]);
  const requested = Array.isArray(searchParams.term) ? searchParams.term[0] : searchParams.term;
  const { terms, selected } = await feeTerms(db, settings.timezone, requested);

  if (!selected) {
    return (
      <EmptyState
        icon={<CalendarRange className="h-6 w-6" />}
        title={t("noTermsTitle")}
        description={t("noTermsDescription")}
        action={
          can(user.role, "academicSettings", "update") ? (
            <Link href="/settings" className={buttonVariants()}>
              {t("goToTerms")}
            </Link>
          ) : undefined
        }
      />
    );
  }

  const schedule = await loadSchedule(db, selected);
  const canEdit = can(user.role, "feeStructure", "update");
  const filled = Object.keys(schedule.amounts).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ParamSelect param="term" label={t("term")} options={terms.map((x) => ({ value: x.id, label: x.name }))} selected={selected.id} />
        {canEdit && terms.length > 1 && schedule.items.length > 0 ? (
          <CopyScheduleButton toTerm={{ id: selected.id, name: selected.name }} terms={terms.filter((x) => x.id !== selected.id).map((x) => ({ id: x.id, name: x.name }))} hasAmounts={filled > 0} />
        ) : null}
      </div>

      {schedule.items.length === 0 ? (
        <EmptyState
          icon={<Coins className="h-6 w-6" />}
          title={t("noItemsTitle")}
          description={t("noItemsDescription")}
          action={
            <Link href="/fees/items" className={buttonVariants()}>
              {t("addItems")}
            </Link>
          }
        />
      ) : schedule.classes.length === 0 ? (
        <EmptyState
          icon={<Coins className="h-6 w-6" />}
          title={t("noClassesTitle")}
          description={t("noClassesDescription", { year: selected.yearName })}
        />
      ) : (
        <ScheduleEditor
          key={selected.id}
          termId={selected.id}
          termName={selected.name}
          items={schedule.items}
          classes={schedule.classes}
          amounts={schedule.amounts}
          currency={settings.currency}
          locale={settings.locale}
          readOnly={!canEdit}
        />
      )}
    </div>
  );
}
