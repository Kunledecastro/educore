import { ScrollText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AUDITED_ENTITY_TYPES, Prisma, Role } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ListFilter } from "@/components/list/list-filter";
import { ListPagination } from "@/components/list/list-pagination";
import { ListSearch } from "@/components/list/list-search";
import { ListToolbar } from "@/components/list/list-toolbar";
import { SortableHeader } from "@/components/list/sortable-header";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { getSettingsForUser } from "@/lib/tenant";
import { AuditDetails } from "./audit-details";

const ACTIONS = ["CREATE", "UPDATE", "DELETE"] as const;

/**
 * ASSUMPTION: accountants see the audit trail for finance records only
 * (least privilege — the permission matrix grants them auditLog:read for
 * reconciling fees, not for reviewing user or grade changes).
 */
const FINANCE_ENTITY_TYPES = ["Invoice", "Payment", "FeeStructure"] as const;

const listConfig = {
  sortable: ["createdAt", "entityType", "action"] as const,
  defaultSort: "createdAt" as const,
  defaultDir: "desc" as const,
  filters: { action: ACTIONS, entityType: AUDITED_ENTITY_TYPES },
};

function pretty(value: Prisma.JsonValue | null): string | null {
  return value === null ? null : JSON.stringify(value, null, 2);
}

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { user, db, isPlatformAdmin } = await requirePermission("auditLog", "read");
  const [t, settings] = await Promise.all([getTranslations("auditLog"), getSettingsForUser(user.tenantId ?? null)]);
  const params = parseListParams(searchParams, listConfig);

  const entityTypes: readonly string[] = user.role === Role.ACCOUNTANT ? FINANCE_ENTITY_TYPES : AUDITED_ENTITY_TYPES;
  const where: Prisma.AuditLogWhereInput = {
    ...(params.filters.action ? { action: params.filters.action as (typeof ACTIONS)[number] } : {}),
    ...(user.role === Role.ACCOUNTANT
      ? { entityType: params.filters.entityType && entityTypes.includes(params.filters.entityType) ? params.filters.entityType : { in: [...entityTypes] } }
      : params.filters.entityType
        ? { entityType: params.filters.entityType }
        : {}),
    ...(params.q
      ? {
          OR: [
            { entityId: { contains: params.q } },
            { actor: { is: { name: { contains: params.q, mode: "insensitive" } } } },
            { actor: { is: { email: { contains: params.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ [params.sort]: params.dir }, { id: "desc" }],
      skip: params.skip,
      take: params.take,
      include: {
        actor: { select: { name: true, email: true } },
        ...(isPlatformAdmin ? { tenant: { select: { name: true } } } : {}),
      },
    }),
  ]);

  const filtered = Boolean(params.q || params.filters.action || params.filters.entityType);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ListToolbar>
        <ListSearch placeholder={t("searchPlaceholder")} />
        <ListFilter name="action" label={t("action")} options={ACTIONS.map((a) => ({ value: a, label: t(`actions.${a}`) }))} />
        <ListFilter name="entityType" label={t("entity")} options={entityTypes.map((e) => ({ value: e, label: e }))} />
      </ListToolbar>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-6 w-6" />}
          title={filtered ? t("noMatches") : t("emptyTitle")}
          description={filtered ? t("noMatchesHint") : t("emptyDescription")}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader column="createdAt" label={t("when")} defaultSort="createdAt" defaultDir="desc" />
                {isPlatformAdmin ? <TableHead>{t("school")}</TableHead> : null}
                <TableHead>{t("who")}</TableHead>
                <SortableHeader column="action" label={t("action")} defaultSort="createdAt" defaultDir="desc" />
                <SortableHeader column="entityType" label={t("entity")} defaultSort="createdAt" defaultDir="desc" />
                <TableHead className="hidden md:table-cell">{t("ip")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("details")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const when = formatDateTime(row.createdAt, settings);
                const who = row.actor?.name ?? row.actor?.email ?? t("systemActor");
                const tenantName = "tenant" in row ? (row.tenant as { name: string } | undefined)?.name : undefined;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{when}</TableCell>
                    {isPlatformAdmin ? <TableCell>{tenantName}</TableCell> : null}
                    <TableCell>
                      <div className="font-medium">
                        {who}
                        {row.impersonatorId ? (
                          <Badge variant="warning" className="ml-2">
                            {t("viaSupport")}
                          </Badge>
                        ) : null}
                      </div>
                      {row.actor?.name && row.actor.email ? (
                        <div className="text-xs text-muted-foreground">{row.actor.email}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.action === "DELETE" ? "destructive" : row.action === "CREATE" ? "default" : "secondary"}>
                        {t(`actions.${row.action}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>{row.entityType}</div>
                      <div className="font-mono text-xs text-muted-foreground">{row.entityId}</div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">{row.ipAddress ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <AuditDetails
                        title={`${t(`actions.${row.action}`)} · ${row.entityType}`}
                        subtitle={`${who} · ${when}`}
                        before={pretty(row.before)}
                        after={pretty(row.after)}
                      />
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
