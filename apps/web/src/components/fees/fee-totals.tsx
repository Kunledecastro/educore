import { getTranslations } from "next-intl/server";
import { cn } from "@educore/ui/utils";
import { formatMoney, type FormatSettings } from "@/lib/format";

type Totals = { count: number; billed: number; paid: number; outstanding: number; overdue: number; overdueCount: number; rate: number | null };

/** Billed / collected / outstanding / overdue tiles for a set of invoices (amounts in minor units). */
export async function FeeTotals({ totals, settings }: { totals: Totals; settings: FormatSettings }) {
  const t = await getTranslations("fees.totals");
  const money = (minor: number) => formatMoney(minor / 100, settings);
  const pct = totals.rate === null ? "—" : new Intl.NumberFormat(settings.locale, { style: "percent", maximumFractionDigits: 0 }).format(totals.rate);
  const tiles = [
    { label: t("billed"), value: money(totals.billed), hint: t("invoices", { count: totals.count }) },
    { label: t("collected"), value: money(totals.paid), hint: t("rate", { rate: pct }) },
    { label: t("outstanding"), value: money(totals.outstanding), hint: null },
    { label: t("overdue"), value: money(totals.overdue), hint: t("overdueCount", { count: totals.overdueCount }), alert: totals.overdue > 0 },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border bg-card p-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tile.label}</dt>
          <dd className={cn("mt-1 text-xl font-semibold tabular-nums", tile.alert && "text-destructive")}>{tile.value}</dd>
          {tile.hint ? <dd className="mt-0.5 text-xs text-muted-foreground">{tile.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
