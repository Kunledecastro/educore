import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { PageHeader } from "@/components/page-header";
import { assignmentViewer } from "@/lib/assignments/data";
import { completionReport, missingWork } from "@/lib/assignments/reports";
import type { AnyRole } from "@/lib/assignments/rules";
import { formatDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Assignment reports (Phase 5.3): completion per class/subject, and who's missing what in one class. */
export default async function AssignmentReportsPage({ searchParams }: { searchParams: SP }) {
  const { user, db } = await requirePermission("submission", "export", { page: true });
  const tenantId = user.tenantId!;
  const viewer = await assignmentViewer(tenantId, { id: user.id, role: user.role as AnyRole });
  if (viewer.role !== "SCHOOL_ADMIN" && viewer.role !== "TEACHER") notFound();
  const [settings, t, terms] = await Promise.all([
    getSettingsForUser(tenantId),
    getTranslations("assignments.reports"),
    db.term.findMany({ where: { academicYear: { isActive: true } }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);
  const termParam = one(searchParams.term);
  const termId = terms.some((x) => x.id === termParam) ? termParam : undefined;
  const sectionParam = idSchema.safeParse(one(searchParams.section));
  const [rows, missing] = await Promise.all([
    completionReport(viewer, { termId }),
    sectionParam.success ? missingWork(viewer, sectionParam.data, { termId }) : Promise.resolve(null),
  ]);
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries({ term: termId, ...extra })) if (val) p.set(k, val);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const exportLink = (kind: string, format: "csv" | "xlsx", extra: Record<string, string | undefined> = {}) => `/api/exports/${kind}${q({ ...extra, format })}`;

  return (
    <div className="space-y-6">
      <Link href="/assignments" className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex gap-2">
            <a href={exportLink("assignment-completion", "xlsx")} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
              <Download className="h-4 w-4" aria-hidden="true" />
              Excel
            </a>
            <a href={exportLink("assignment-completion", "csv")} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
              CSV
            </a>
          </div>
        }
      />
      <nav aria-label={t("termFilter")} className="flex flex-wrap gap-2 text-sm">
        {[{ id: undefined as string | undefined, name: t("wholeYear") }, ...terms].map((x) => (
          <Link
            key={x.id ?? "year"}
            href={`/assignments/reports${x.id ? `?term=${x.id}` : ""}`}
            aria-current={termId === x.id ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${termId === x.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {x.name}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("class")}</TableHead>
                <TableHead>{t("subject")}</TableHead>
                <TableHead className="text-right">{t("assignments")}</TableHead>
                <TableHead className="text-right">{t("handedIn")}</TableHead>
                <TableHead className="text-right">{t("late")}</TableHead>
                <TableHead className="text-right">{t("missing")}</TableHead>
                <TableHead className="text-right">{t("marked")}</TableHead>
                <TableHead className="text-right">{t("rate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.sectionId}:${r.subjectId}`}>
                  <TableCell>
                    <Link href={`/assignments/reports${q({ section: r.sectionId })}`} className="underline-offset-2 hover:underline">
                      {r.className}
                    </Link>
                  </TableCell>
                  <TableCell>{r.subject}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.assignments}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.handedIn}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.late}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.missing}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.marked}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.rate === null ? "—" : `${r.rate}%`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("rateNote")}</p>

      {missing ? (
        <section className="space-y-3" aria-labelledby="missing-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="missing-title" className="text-lg font-semibold">
              {t("missingTitle", { name: missing.className })}
            </h2>
            <div className="flex gap-2">
              <a href={exportLink("assignment-missing", "xlsx", { section: sectionParam.success ? sectionParam.data : undefined })} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                <Download className="h-4 w-4" aria-hidden="true" />
                Excel
              </a>
              <a href={exportLink("assignment-missing", "csv", { section: sectionParam.success ? sectionParam.data : undefined })} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                CSV
              </a>
            </div>
          </div>
          {missing.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("nobodyMissing")}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {missing.rows.map((r) => (
                <li key={r.student.id} className="p-3">
                  <p className="font-medium">
                    {r.student.name} <span className="font-mono text-xs text-muted-foreground">{r.student.admissionNo}</span>{" "}
                    <span className="text-sm text-destructive">{t("missingCount", { count: r.missing.length })}</span>
                  </p>
                  <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                    {r.missing.map((m) => (
                      <li key={m.assignmentId}>
                        <Link href={`/assignments/${m.assignmentId}`} className="underline-offset-2 hover:underline">
                          {m.subject}: {m.title}
                        </Link>{" "}
                        · {t("due", { when: formatDateTime(m.dueAt, settings) })}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : sectionParam.success ? null : (
        <p className="text-sm text-muted-foreground">{t("pickClass")}</p>
      )}
    </div>
  );
}
