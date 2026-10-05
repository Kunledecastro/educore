import Link from "next/link";
import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { platformPrisma, type Prisma } from "@educore/db";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ListFilter } from "@/components/list/list-filter";
import { ListPagination } from "@/components/list/list-pagination";
import { ListToolbar } from "@/components/list/list-toolbar";
import { PageHeader } from "@/components/page-header";
import { PLATFORM_FORMAT } from "@/components/platform/display";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";

const PLATFORM_ACTIONS = ["TENANT_SUSPEND", "TENANT_REACTIVATE", "IMPERSONATION_START", "IMPERSONATION_END", "PLAN_UPDATE", "TENANT_PLAN_CHANGE"] as const;

/** Everything platform admins have done (Phase 4.0). Read-only; the table itself is append-only. */
export default async function PlatformAuditPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const ctx = await requireUser();
  if (!ctx.isPlatformAdmin) redirect("/dashboard");
  const [t, tl] = await Promise.all([getTranslations("platform"), getTranslations("list")]);
  const params = parseListParams(searchParams, { sortable: ["createdAt"] as const, defaultSort: "createdAt" as const, defaultDir: "desc", filters: { action: PLATFORM_ACTIONS } });
  const where: Prisma.PlatformAuditLogWhereInput = params.filters.action ? { action: params.filters.action } : {};
  const db = platformPrisma();
  const [total, rows] = await Promise.all([
    db.platformAuditLog.count({ where }),
    db.platformAuditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: params.skip, take: params.take }),
  ]);
  const [actors, tenants] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))] } }, select: { id: true, name: true } }),
    db.tenant.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.tenantId ? [r.tenantId] : [])))] } }, select: { id: true, name: true } }),
  ]);
  const actorName = new Map(actors.map((a) => [a.id, a.name]));
  const tenantName = new Map(tenants.map((x) => [x.id, x.name]));
  const known = new Set<string>(PLATFORM_ACTIONS);

  return (
    <div>
      <PageHeader title={t("audit.title")} description={t("audit.description")} />
      <ListToolbar>
        <ListFilter name="action" label={t("audit.action")} options={PLATFORM_ACTIONS.map((a) => ({ value: a, label: t(`audit.actions.${a}`) }))} />
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="h-6 w-6" />} title={total === 0 && !params.filters.action ? t("audit.emptyTitle") : tl("noResults")} description={t("audit.emptyDescription")} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("audit.when")}</TableHead>
                <TableHead>{t("audit.who")}</TableHead>
                <TableHead>{t("audit.action")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("audit.school")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("audit.details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const after = (r.after ?? {}) as Record<string, unknown>;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt, PLATFORM_FORMAT)}</TableCell>
                    <TableCell className="text-sm">{(r.actorId && actorName.get(r.actorId)) ?? "—"}</TableCell>
                    <TableCell className="text-sm">{known.has(r.action) ? t(`audit.actions.${r.action as (typeof PLATFORM_ACTIONS)[number]}`) : r.action}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {r.tenantId ? (
                        <Link href={`/platform/tenants/${r.tenantId}`} className="text-primary underline-offset-4 hover:underline">
                          {tenantName.get(r.tenantId) ?? r.tenantId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-xs truncate text-xs text-muted-foreground lg:table-cell">
                      {typeof after.reason === "string" ? after.reason : typeof after.suspendedReason === "string" ? after.suspendedReason : ""}
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
