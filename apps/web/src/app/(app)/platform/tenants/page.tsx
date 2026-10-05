import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { platformPrisma } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ExportMenu } from "@/components/list/export-menu";
import { ListFilter } from "@/components/list/list-filter";
import { ListPagination } from "@/components/list/list-pagination";
import { ListSearch } from "@/components/list/list-search";
import { ListToolbar } from "@/components/list/list-toolbar";
import { SortableHeader } from "@/components/list/sortable-header";
import { PageHeader } from "@/components/page-header";
import { formatDateOnly, formatDateTime, formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import type { SearchParamsInput } from "@/lib/list-params";
import { PLANS, TENANT_STATUSES, tenantListQuery, trialDaysLeft, usageFor } from "@/lib/platform-data";
import { PLATFORM_FORMAT, STATUS_VARIANT } from "@/components/platform/display";

/** Platform console (Phase 4.0): every school, with plan, status and usage. */
export default async function PlatformTenantsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const ctx = await requireUser();
  if (!ctx.isPlatformAdmin) redirect("/dashboard");
  const [t, tl] = await Promise.all([getTranslations("platform"), getTranslations("list")]);
  const fmt = PLATFORM_FORMAT;
  const { params, where, orderBy } = tenantListQuery(searchParams);
  const db = platformPrisma();
  const [total, all, tenants] = await Promise.all([
    db.tenant.count({ where }),
    db.tenant.count(),
    db.tenant.findMany({ where, orderBy, skip: params.skip, take: params.take, include: { subscription: { select: { status: true, currentPeriodEnd: true } } } }),
  ]);
  const usage = await usageFor(tenants.map((x) => x.id));

  return (
    <div>
      <PageHeader title={t("tenants.title")} description={t("tenants.description", { count: all })} actions={all > 0 ? <ExportMenu kind="tenants" /> : null} />
      <ListToolbar>
        <ListSearch placeholder={t("tenants.search")} />
        <ListFilter name="status" label={t("tenants.status")} options={TENANT_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />
        <ListFilter name="plan" label={t("tenants.plan")} options={PLANS.map((p) => ({ value: p, label: t(`plans.${p}`) }))} />
      </ListToolbar>
      {tenants.length === 0 ? (
        <EmptyState icon={<Building2 className="h-6 w-6" />} title={all === 0 ? t("tenants.emptyTitle") : tl("noResults")} description={all === 0 ? t("tenants.emptyDescription") : tl("noResultsHint")} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader column="name" label={t("tenants.school")} defaultSort="createdAt" defaultDir="desc" />
                <TableHead>{t("tenants.plan")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t("tenants.students")}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{t("tenants.staff")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("tenants.lastActivity")}</TableHead>
                <SortableHeader column="createdAt" label={t("tenants.joined")} defaultSort="createdAt" defaultDir="desc" className="hidden md:table-cell" />
                <TableHead>{t("tenants.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((x) => {
                const u = usage.get(x.id)!;
                const days = trialDaysLeft(x);
                return (
                  <TableRow key={x.id}>
                    <TableCell>
                      <Link href={`/platform/tenants/${x.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {x.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{x.slug}</div>
                    </TableCell>
                    <TableCell>
                      {t(`plans.${x.plan}`)}
                      {days !== null ? <div className={`text-xs ${days < 0 ? "text-destructive" : "text-muted-foreground"}`}>{days < 0 ? t("tenants.trialOver") : t("tenants.trialLeft", { days })}</div> : null}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatNumber(u.students, fmt)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatNumber(u.staff, fmt)}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{u.lastActivity ? formatDateTime(u.lastActivity, fmt) : "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatDateOnly(x.createdAt, fmt)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[x.status]}>{t(`statuses.${x.status}`)}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <ListPagination page={params.page} pageSize={params.pageSize} total={total} />
    </div>
  );
}
