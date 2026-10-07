import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ListPagination } from "@/components/list/list-pagination";
import { PageHeader } from "@/components/page-header";
import { accessLog } from "@/lib/health/data";
import { formatDateTime } from "@/lib/format";
import { requirePermission, auditContextFor } from "@/lib/guard";
import { healthViewer } from "@/lib/health/data";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { getSettingsForUser } from "@/lib/tenant";

/** School admins (Phase 7.0): who opened which pupil's health record, and when. Never the content. */
export default async function HealthAccessLogPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const ctx = await requirePermission("healthAccessLog", "read", { page: true });
  if (ctx.user.role !== "SCHOOL_ADMIN") notFound();
  const a = auditContextFor(ctx);
  const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
  const params = parseListParams(searchParams, { sortable: ["at"] as const, defaultSort: "at" as const, defaultPageSize: 50, pageSizes: [50] });
  const [data, settings, t, tr] = await Promise.all([accessLog(viewer, { skip: params.skip, take: params.take }), getSettingsForUser(a.tenantId), getTranslations("health.accessLog"), getTranslations("roles")]);
  return (
    <div className="space-y-6">
      <Link href="/clinic" className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <PageHeader title={t("title")} description={t("description")} />
      {data.rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("when")}</TableHead>
                <TableHead>{t("who")}</TableHead>
                <TableHead>{t("pupil")}</TableHead>
                <TableHead>{t("what")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.at, settings)}</TableCell>
                  <TableCell>
                    {r.actor}
                    <span className="block text-xs text-muted-foreground">{tr(r.actorRole as never)}</span>
                  </TableCell>
                  <TableCell>{r.pupil}</TableCell>
                  <TableCell>{t.has(`actions.${r.action}`) ? t(`actions.${r.action}` as never) : r.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data.total > params.pageSize ? <ListPagination page={params.page} pageSize={params.pageSize} total={data.total} /> : null}
    </div>
  );
}
