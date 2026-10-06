import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { NewAssignmentButton } from "@/components/assignments/assignment-form";
import { FamilyAssignmentList } from "@/components/assignments/family-list";
import { ParentSubmitSetting } from "@/components/assignments/parent-submit-setting";
import { getAssignmentSettings } from "@/lib/assignments/submissions";
import { STATUS_VARIANT } from "@/components/assignments/status";
import { ListPagination } from "@/components/list/list-pagination";
import { PageHeader } from "@/components/page-header";
import { assignmentOptions, assignmentViewer, listForFamily, listForStaff } from "@/lib/assignments/data";
import type { AnyRole } from "@/lib/assignments/rules";
import { formatDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { getSettingsForUser } from "@/lib/tenant";
import { utcToZonedLocal } from "@/lib/zoned-time";

const STATUSES = ["PUBLISHED", "DRAFT", "CLOSED"] as const;

/** Assignments (Phase 5.1): staff see what they've set; students and parents see what's due. */
export default async function AssignmentsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { user } = await requirePermission("assignment", "read", { page: true });
  const tenantId = user.tenantId!;
  const [viewer, settings, t] = await Promise.all([
    assignmentViewer(tenantId, { id: user.id, role: user.role as AnyRole }),
    getSettingsForUser(tenantId),
    getTranslations("assignments"),
  ]);

  if (viewer.role === "STUDENT" || viewer.role === "PARENT") {
    const children = await listForFamily(viewer);
    return (
      <div className="space-y-6">
        <PageHeader title={t("pageTitle")} description={viewer.role === "STUDENT" ? t("studentDescription") : t("parentDescription")} />
        <FamilyAssignmentList families={children} settings={settings} showNames={viewer.role === "PARENT"} />
      </div>
    );
  }

  const params = parseListParams(searchParams, { sortable: ["dueAt"] as const, defaultSort: "dueAt" as const, defaultPageSize: 25 });
  const raw = searchParams instanceof URLSearchParams ? searchParams.get("status") : searchParams.status;
  const statusParam = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as (typeof STATUSES)[number]) : undefined;
  const [{ rows, total }, subjects, assignmentSettings] = await Promise.all([
    listForStaff(viewer, { status, skip: params.skip, take: params.take }),
    can(user.role, "assignment", "create") ? assignmentOptions(viewer) : Promise.resolve([]),
    viewer.role === "SCHOOL_ADMIN" ? getAssignmentSettings(tenantId) : Promise.resolve(null),
  ]);
  const week = new Date(Date.now() + 7 * 86400_000);
  const defaultDue = `${utcToZonedLocal(week, settings.timezone).slice(0, 10)}T16:00`;

  return (
    <div className="space-y-6">
      <PageHeader title={t("pageTitle")} description={t("staffDescription")} actions={subjects.length > 0 ? <NewAssignmentButton options={{ subjects, defaultDue }} /> : null} />
      {assignmentSettings ? <ParentSubmitSetting initial={assignmentSettings.parentSubmit} /> : null}
      <nav aria-label={t("filter")} className="flex flex-wrap gap-2 text-sm">
        {[undefined, ...STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/assignments?status=${s}` : "/assignments"}
            aria-current={status === s ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${status === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {s ? t(`statuses.${s}`) : t("all")}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          icon={<NotebookPen className="h-6 w-6" />}
          title={t("emptyTitle")}
          description={subjects.length > 0 ? t("emptyStaff") : user.role === "TEACHER" ? t("emptyNoSubjects") : t("emptyStaff")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("title")}</TableHead>
                <TableHead>{t("class")}</TableHead>
                <TableHead>{t("subject")}</TableHead>
                <TableHead>{t("due")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-right">{t("handedIn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <Link href={`/assignments/${r.id}`} className="underline-offset-2 hover:underline">
                      {r.title}
                    </Link>
                    {r.mode === "PAPER" ? <span className="ml-2 text-xs text-muted-foreground">{t("modes.PAPER")}</span> : null}
                  </TableCell>
                  <TableCell>{r.className}</TableCell>
                  <TableCell>{r.subject}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.dueAt, settings)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{t(`statuses.${r.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.mode === "ONLINE" ? t("handedInCount", { count: r.handedIn, total: r.classSize }) : "—"}
                    {r.toMark > 0 ? <span className="ml-2 text-xs text-muted-foreground">{t("toMark", { count: r.toMark })}</span> : null}
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
