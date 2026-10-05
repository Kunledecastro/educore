import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { platformPrisma } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { PageHeader } from "@/components/page-header";
import { PLATFORM_FORMAT } from "@/components/platform/display";
import { loadPlans } from "@/lib/entitlements-data";
import { formatDateOnly, formatMoney, formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { EditPlanButton } from "./plan-editor";

/** The plan catalogue (4.1), for the platform team. Changes apply to every school on the plan at once. */
export default async function PlatformPlansPage() {
  const ctx = await requireUser();
  if (!ctx.isPlatformAdmin) redirect("/dashboard");
  const [plans, counts, t, tm] = await Promise.all([
    loadPlans(),
    platformPrisma().tenant.groupBy({ by: ["plan"], _count: { _all: true } }),
    getTranslations("platform.plansPage"),
    getTranslations("plan.modules"),
  ]);
  const schools = new Map(counts.map((c) => [c.plan, c._count._all]));
  const fmt = PLATFORM_FORMAT;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("plan")}</TableHead>
              <TableHead className="text-right">{t("price")}</TableHead>
              <TableHead className="text-right">{t("maxStudents")}</TableHead>
              <TableHead>{t("modules")}</TableHead>
              <TableHead className="text-right">{t("schools")}</TableHead>
              <TableHead>{t("updated")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((p) => (
              <TableRow key={p.code}>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {p.code}
                    {p.isPublic ? null : <Badge variant="secondary">{t("hidden")}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(p.priceMinor / 100, fmt)}</TableCell>
                <TableCell className="text-right tabular-nums">{p.maxStudents === null ? t("unlimited") : formatNumber(p.maxStudents, fmt)}</TableCell>
                <TableCell className="max-w-xs text-sm">{p.modules.map((m) => tm(m)).join(", ")}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(schools.get(p.code) ?? 0, fmt)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.updatedAt ? formatDateOnly(p.updatedAt, fmt) : "—"}</TableCell>
                <TableCell className="text-right">
                  <EditPlanButton
                    plan={{
                      code: p.code,
                      name: p.name,
                      price: (p.priceMinor / 100).toString(),
                      maxStudents: p.maxStudents === null ? "" : String(p.maxStudents),
                      modules: [...p.modules],
                      isPublic: p.isPublic,
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-sm text-muted-foreground">{t("note")}</p>
    </div>
  );
}
