import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { withRls } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { HealthNotConfigured } from "@/components/health/not-configured";
import { ListPagination } from "@/components/list/list-pagination";
import { ListSearch } from "@/components/list/list-search";
import { ParamSelect } from "@/components/list/param-select";
import { PageHeader } from "@/components/page-header";
import { clinicList, type ListStatus } from "@/lib/health/data";
import { healthPage } from "@/lib/health/page";
import { formatDateTime } from "@/lib/format";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";

const STATUSES: ListStatus[] = ["none", "SUBMITTED", "CHANGED", "VERIFIED"];
const VARIANT = { none: "outline", SUBMITTED: "warning", CHANGED: "warning", VERIFIED: "success" } as const;

function one(searchParams: SearchParamsInput, key: string) {
  const raw = searchParams instanceof URLSearchParams ? searchParams.get(key) : searchParams[key];
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

/**
 * The clinic (Phase 7.0): every pupil with the status of their health
 * profile. Only statuses — no health details — so viewing this list isn't
 * logged; opening a record is.
 */
export default async function ClinicPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { viewer, configured } = await healthPage("read");
  if (viewer.role === "PARENT") redirect("/health");
  const t = await getTranslations("health");
  if (!configured) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("clinic.title")} />
        <HealthNotConfigured />
      </div>
    );
  }
  const params = parseListParams(searchParams, { sortable: ["name"] as const, defaultSort: "name" as const, defaultPageSize: 25 });
  const statusParam = one(searchParams, "status");
  const status = (STATUSES as string[]).includes(statusParam) ? (statusParam as ListStatus) : undefined;
  const classParam = idSchema.safeParse(one(searchParams, "class"));
  const classId = classParam.success ? classParam.data : undefined;

  const [data, classes, settings] = await Promise.all([
    clinicList(viewer, { q: params.q || undefined, classId, status, skip: params.skip, take: params.take }),
    withRls(viewer.tenantId, (tx) => tx.classGrade.findMany({ where: { tenantId: viewer.tenantId }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } })),
    getSettingsForUser(viewer.tenantId),
  ]);
  const query = (s?: ListStatus) => {
    const q = new URLSearchParams();
    if (s) q.set("status", s);
    if (params.q) q.set("q", params.q);
    if (classId) q.set("class", classId);
    const str = q.toString();
    return str ? `/clinic?${str}` : "/clinic";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("clinic.title")}
        description={viewer.role === "SCHOOL_NURSE" ? t("clinic.nurseDescription") : data.canOpen ? t("clinic.adminDescriptionOpen") : t("clinic.adminDescription")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/health-alerts" className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted">
              {t("alerts.pageTitle")}
            </Link>
            {viewer.role === "SCHOOL_ADMIN" ? (
              <>
                <Link href="/clinic/access-log" className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted">
                  {t("accessLog.link")}
                </Link>
                <Link href="/settings/health" className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted">
                  {t("settings.link")}
                </Link>
              </>
            ) : null}
          </div>
        }
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["pupils", "none", "SUBMITTED", "CHANGED", "VERIFIED"] as const).map((k) => (
          <div key={k} className="rounded-lg border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{t(`clinic.summary.${k}`)}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{data.summary[k]}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <ListSearch placeholder={t("clinic.search")} />
        </div>
        <ParamSelect param="class" label={t("clinic.class")} selected={classId ?? ""} options={[{ value: "", label: t("clinic.allClasses") }, ...classes.map((c) => ({ value: c.id, label: c.name }))]} />
      </div>
      <nav aria-label={t("clinic.filter")} className="flex flex-wrap gap-2 text-sm">
        {[undefined, ...STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={query(s)}
            aria-current={status === s ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${status === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {s ? t(`status.${s}`) : t("clinic.all")}
          </Link>
        ))}
      </nav>

      {data.rows.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">{t("clinic.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("clinic.pupil")}</TableHead>
                <TableHead>{t("clinic.class")}</TableHead>
                <TableHead>{t("clinic.status")}</TableHead>
                <TableHead>{t("clinic.contacts")}</TableHead>
                <TableHead>{t("clinic.updated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {data.canOpen ? (
                      <Link href={`/clinic/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.name}</span>
                    )}
                    <span className="block text-xs text-muted-foreground">{r.admissionNo}</span>
                  </TableCell>
                  <TableCell>{r.className ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={VARIANT[r.status]}>{t(`status.${r.status}`)}</Badge>
                  </TableCell>
                  <TableCell>{r.hasContacts ? t("clinic.yes") : <span className="text-muted-foreground">{t("clinic.no")}</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{r.updatedAt ? formatDateTime(r.updatedAt, settings) : "—"}</TableCell>
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
