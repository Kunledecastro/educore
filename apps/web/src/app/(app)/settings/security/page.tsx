import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ListPagination } from "@/components/list/list-pagination";
import { requirePermission } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { schoolAccounts } from "@/lib/security/school-security";
import { ResetTwoFactorButton, TeacherRequirementForm } from "./controls";

const FILTERS = ["all", "missing", "on"] as const;

/** Settings → Security (Phase 6.0): the teachers rule, who has 2FA on, and resets for lost phones. */
export default async function SchoolSecurityPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { user } = await requirePermission("user", "update", { page: true });
  const params = parseListParams(searchParams, { sortable: ["name"] as const, defaultSort: "name" as const, defaultPageSize: 25 });
  const raw = searchParams instanceof URLSearchParams ? searchParams.get("show") : searchParams.show;
  const show = (FILTERS as readonly string[]).includes(String(Array.isArray(raw) ? raw[0] : raw)) ? (String(Array.isArray(raw) ? raw[0] : raw) as (typeof FILTERS)[number]) : "all";
  const [data, t, tr] = await Promise.all([
    schoolAccounts(user.tenantId!, { q: params.q, filter: show, skip: params.skip, take: params.take }),
    getTranslations("twoFactor.school"),
    getTranslations("roles"),
  ]);

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border bg-card p-5" aria-labelledby="sec-rule">
        <h2 id="sec-rule" className="font-semibold">
          {t("ruleTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("ruleExplain")}</p>
        {data.school.exempt ? <p className="rounded-md border border-warning p-3 text-sm">{t("exemptNote")}</p> : null}
        <TeacherRequirementForm initial={data.school.requireTeacher2fa} />
      </section>

      <section className="space-y-3" aria-labelledby="sec-people">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sec-people" className="font-semibold">
            {t("peopleTitle")}
          </h2>
          {data.missing > 0 ? <p className="text-sm text-destructive">{t("missingCount", { count: data.missing })}</p> : <p className="text-sm text-muted-foreground">{t("allSet")}</p>}
        </div>
        <form className="flex flex-wrap gap-2" role="search">
          <input type="hidden" name="show" value={show} />
          <label htmlFor="sec-q" className="sr-only">
            {t("search")}
          </label>
          <input id="sec-q" name="q" defaultValue={params.q ?? ""} placeholder={t("search")} className="h-9 rounded-md border bg-background px-3 text-sm" />
          <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
            {t("searchButton")}
          </button>
        </form>
        <nav aria-label={t("filter")} className="flex flex-wrap gap-2 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={`/settings/security?show=${f}${params.q ? `&q=${encodeURIComponent(params.q)}` : ""}`}
              aria-current={show === f ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${show === f ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {t(`filters.${f}`)}
            </Link>
          ))}
        </nav>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("role")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-muted-foreground">{r.email}</span>
                  </TableCell>
                  <TableCell>{tr(r.role as never)}</TableCell>
                  <TableCell>
                    {r.twoFactorEnabled ? (
                      <Badge variant="success">{t("on")}</Badge>
                    ) : r.required ? (
                      <Badge variant="destructive">{t("requiredOff")}</Badge>
                    ) : (
                      <Badge variant="secondary">{t("off")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{r.twoFactorEnabled && r.id !== user.id ? <ResetTwoFactorButton userId={r.id} name={r.name} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {data.total > params.pageSize ? <ListPagination page={params.page} pageSize={params.pageSize} total={data.total} /> : null}
        <p className="text-xs text-muted-foreground">{t("requiredNote")}</p>
      </section>
    </div>
  );
}
