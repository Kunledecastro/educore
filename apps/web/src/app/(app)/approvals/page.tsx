import Link from "next/link";
import { Stamp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ListPagination } from "@/components/list/list-pagination";
import { PageHeader } from "@/components/page-header";
import { headline, STATUS_VARIANT } from "@/lib/approvals/describe";
import { listRequests, type InboxTab } from "@/lib/approvals/engine";
import { formatDateTime, formatMoney } from "@/lib/format";
import { auditContextFor, requirePermission } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { getSettingsForUser } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "FAILED", "WITHDRAWN", "EXPIRED"] as const;

function one(sp: SearchParamsInput, key: string) {
  const raw = sp instanceof URLSearchParams ? sp.get(key) : sp[key];
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

/** Approvals (Phase 8.0): what's waiting for me, what I asked for, and (admins) everything. */
export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const ctx = await requirePermission("approval", "read", { page: true });
  const a = auditContextFor(ctx);
  const actor = { tenantId: a.tenantId, userId: ctx.user.id, role: ctx.user.role, impersonating: Boolean(ctx.impersonation) };
  const isAdmin = ctx.user.role === "SCHOOL_ADMIN";
  const tabParam = one(searchParams, "tab");
  const tab: InboxTab = tabParam === "mine" || (tabParam === "all" && isAdmin) ? (tabParam as InboxTab) : "waiting";
  const statusParam = one(searchParams, "status");
  const status = (STATUSES as readonly string[]).includes(statusParam) ? statusParam : undefined;
  const params = parseListParams(searchParams, { sortable: ["createdAt"] as const, defaultSort: "createdAt" as const, defaultPageSize: 25 });
  const [{ rows, total }, settings, t] = await Promise.all([
    listRequests(actor, { tab, status: tab === "waiting" ? undefined : status, skip: params.skip, take: params.take }),
    getSettingsForUser(a.tenantId),
    getTranslations("approvals"),
  ]);
  const tabs: InboxTab[] = isAdmin ? ["waiting", "mine", "all"] : ["waiting", "mine"];
  const href = (next: { tab?: InboxTab; status?: string }) => {
    const q = new URLSearchParams();
    const tb = next.tab ?? tab;
    if (tb !== "waiting") q.set("tab", tb);
    const st = next.status ?? "";
    if (st && tb !== "waiting") q.set("status", st);
    const s = q.toString();
    return s ? `/approvals?${s}` : "/approvals";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          isAdmin ? (
            <Link href="/settings/approvals" className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted">
              {t("settingsLink")}
            </Link>
          ) : null
        }
      />
      <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-1 border-b">
        {tabs.map((x) => (
          <Link
            key={x}
            href={href({ tab: x })}
            aria-current={tab === x ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === x ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t(`tabs.${x}`)}
          </Link>
        ))}
      </nav>
      {tab !== "waiting" ? (
        <nav aria-label={t("statusFilter")} className="flex flex-wrap gap-2 text-sm">
          {[undefined, ...STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={href({ status: s })}
              aria-current={status === s ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${status === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {s ? t(`status.${s}`) : t("allStatuses")}
            </Link>
          ))}
        </nav>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={<Stamp className="h-8 w-8" aria-hidden="true" />} title={t(`empty.${tab}`)} description={tab === "waiting" ? t("emptyWaitingHint") : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("col.request")}</TableHead>
                <TableHead className="text-right">{t("col.amount")}</TableHead>
                <TableHead>{t("col.requestedBy")}</TableHead>
                <TableHead>{t("col.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/approvals/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                      {headline(t as never, r.process, r.summary)}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {t(`process.${r.process}`)}
                      {r.stepsRequired > 1 ? ` · ${t("stepOf", { step: r.currentStep, steps: r.stepsRequired })}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{r.amountMinor !== null ? formatMoney(r.amountMinor / 100, settings) : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {r.requestedBy}
                    <span className="block text-xs text-muted-foreground">{formatDateTime(r.createdAt, settings)}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{t(`status.${r.status}`)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {total > params.pageSize ? <ListPagination page={params.page} pageSize={params.pageSize} total={total} /> : null}
    </div>
  );
}
