import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { MAX_STORED_ISSUES } from "@/lib/imports/engine";
import { IMPORTERS } from "@/lib/imports/registry";
import type { ImportOptions, RowIssue } from "@/lib/imports/types";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";
import { ImportStatusBadge } from "../status-badge";
import { AutoRefresh, CancelImportButton, DownloadIssuesButton, StartImportButton, UploadAgainLink } from "./report-controls";

export default async function ImportReportPage({ params }: { params: { id: string } }) {
  const ctx = await requireUser();
  if (ctx.isPlatformAdmin) redirect("/dashboard");
  const id = idSchema.safeParse(params.id);
  if (!id.success) notFound();

  const job = await ctx.db.importJob.findUnique({
    where: { id: id.data },
    select: {
      id: true, kind: true, status: true, fileName: true, options: true, totalRows: true, validRows: true, errorRows: true,
      processedRows: true, createdRows: true, updatedRows: true, failedRows: true, errors: true, importErrors: true,
      createdAt: true, finishedAt: true, createdBy: { select: { name: true } },
    },
  });
  if (!job) notFound();
  const [resource, action] = IMPORTERS[job.kind].permission;
  if (!can(ctx.user.role, resource, action)) notFound();

  const [t, tRoot, tr, settings] = await Promise.all([
    getTranslations("imports"),
    getTranslations(),
    getTranslations("roles"),
    getSettingsForUser(ctx.user.tenantId ?? null),
  ]);
  // Bank-statement imports live on the Payments page (finance staff can't open /imports).
  const home = job.kind === "PAYMENTS" ? "/payments" : "/imports";
  const yearId = (job.options as ImportOptions).academicYearId;
  const year = yearId ? await ctx.db.academicYear.findUnique({ where: { id: yearId }, select: { name: true } }) : null;

  const describe = (i: RowIssue) => {
    const params = { ...(i.params ?? {}) };
    if (typeof params.current === "string" && ["TEACHER", "SCHOOL_ADMIN", "ACCOUNTANT", "PARENT", "STUDENT"].includes(params.current)) {
      params.current = tr(params.current as "TEACHER");
    }
    try {
      return tRoot(i.message as never, params as never);
    } catch {
      return i.message;
    }
  };
  const validationIssues = job.errors as unknown as RowIssue[];
  const importIssues = job.importErrors as unknown as RowIssue[];
  const fatal = job.status === "VALIDATED" && job.validRows === 0 && validationIssues.some((i) => i.row === 0);
  const running = job.status === "QUEUED" || job.status === "IMPORTING";
  const n = (v: number) => formatNumber(v, settings);
  const pct = job.validRows ? Math.round((job.processedRows / job.validRows) * 100) : 0;

  const issueTable = (issues: RowIssue[], title: string) => {
    const rows: [string, string, string][] = issues.map((i) => [i.row === 0 ? t("report.wholeFile") : String(i.row), i.column ?? "", describe(i)]);
    return (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {rows.length ? <DownloadIssuesButton fileName={job.fileName} rows={rows} /> : null}
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              {t("report.noIssues")}
            </p>
          ) : (
            <>
              {issues.length >= MAX_STORED_ISSUES ? (
                <p className="mb-2 text-sm text-muted-foreground">{t("report.issuesTruncated", { count: MAX_STORED_ISSUES })}</p>
              ) : null}
              <div className="max-h-[32rem] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">{t("report.row")}</TableHead>
                      <TableHead className="w-40">{t("report.column")}</TableHead>
                      <TableHead>{t("report.problem")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(([row, col, msg], idx) => (
                      <TableRow key={idx}>
                        <TableCell className="tabular-nums">{row}</TableCell>
                        <TableCell className="font-mono text-xs">{col}</TableCell>
                        <TableCell>{msg}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  const stat = (label: string, value: string, tone?: "warn" | "ok") => (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-destructive" : tone === "ok" ? "text-success" : ""}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <AutoRefresh active={running} />
      <Link href={home} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {job.kind === "PAYMENTS" ? t("report.backPayments") : t("report.back")}
      </Link>
      <PageHeader
        title={`${t(`kinds.${job.kind}`)} · ${job.fileName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ImportStatusBadge status={job.status} />
            <span>{t("report.uploadedBy", { name: job.createdBy?.name ?? "—", when: formatDateTime(job.createdAt, settings) })}</span>
            {year ? <span>· {t("report.forYear", { year: year.name })}</span> : null}
          </span>
        }
      />

      {job.status === "VALIDATED" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {stat(t("report.total"), n(job.totalRows))}
            {stat(t("report.ready"), n(job.validRows), job.validRows ? "ok" : undefined)}
            {stat(t("report.problems"), n(job.errorRows), job.errorRows ? "warn" : undefined)}
          </div>
          {fatal ? (
            <div role="alert" className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
              <div>
                <p className="font-medium">{t("report.fatalTitle")}</p>
                <p className="text-muted-foreground">{t("report.fatalHint")}</p>
              </div>
            </div>
          ) : job.errorRows > 0 ? (
            <p className="text-sm text-muted-foreground">{t("report.readyHint")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {job.validRows > 0 ? <StartImportButton jobId={job.id} count={job.validRows} /> : null}
            <UploadAgainLink href={home} />
            <CancelImportButton jobId={job.id} />
          </div>
          {issueTable(validationIssues, t("report.issuesTitle"))}
        </>
      ) : running ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-medium" aria-live="polite">
              {job.status === "QUEUED" ? t("report.queued") : t("report.progress", { done: n(job.processedRows), total: n(job.validRows) })}
            </p>
            <div
              role="progressbar"
              aria-label={t("report.progressLabel")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-3 w-full overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
            </div>
            <CancelImportButton jobId={job.id} />
          </CardContent>
        </Card>
      ) : (
        <>
          {job.status === "FAILED" ? (
            <div role="alert" className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
              <div>
                <p className="font-medium">{t("report.failedTitle")}</p>
                <p className="text-muted-foreground">{t("report.failedHint")}</p>
              </div>
            </div>
          ) : null}
          {job.status === "COMPLETED" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {stat(t("report.created"), n(job.createdRows), "ok")}
              {stat(t("report.updated"), n(job.updatedRows))}
              {stat(t("report.failed"), n(job.failedRows), job.failedRows ? "warn" : undefined)}
            </div>
          ) : null}
          <UploadAgainLink href={home} />
          {job.status === "COMPLETED" ? issueTable(importIssues, t("report.importIssuesTitle")) : null}
          {validationIssues.length ? issueTable(validationIssues, t("report.issuesTitle")) : null}
        </>
      )}
    </div>
  );
}
