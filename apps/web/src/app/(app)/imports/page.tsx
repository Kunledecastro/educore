import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@educore/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, formatNumber } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { IMPORTERS, IMPORT_KINDS } from "@/lib/imports/registry";
import { getSettingsForUser } from "@/lib/tenant";
import { ImportStatusBadge } from "./status-badge";
import { UploadCard } from "./upload-form";

export default async function ImportsPage() {
  const { db, user, isPlatformAdmin } = await requirePermission("student", "import", { page: true });
  if (isPlatformAdmin) redirect("/dashboard"); // imports are per school
  const [t, settings] = await Promise.all([getTranslations("imports"), getSettingsForUser(user.tenantId ?? null)]);
  const [years, jobs] = await Promise.all([
    db.academicYear.findMany({ orderBy: { startDate: "desc" }, select: { id: true, name: true, isActive: true } }),
    db.importJob.findMany({
      where: { kind: { not: "PAYMENTS" } }, // bank statements are on the Payments page
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, kind: true, status: true, fileName: true, totalRows: true, validRows: true,
        createdRows: true, updatedRows: true, failedRows: true, createdAt: true,
      },
    }),
  ]);
  const defaultYearId = years.find((y) => y.isActive)?.id ?? years[0]?.id ?? null;
  // Suggested order: classes first (students reference them), then staff, then students.
  const order = ["CLASSES", "STAFF", "STUDENTS"] as const;

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-4 lg:grid-cols-3">
        {order.filter((k) => IMPORT_KINDS.includes(k)).map((kind) => (
          <UploadCard key={kind} kind={kind} needsYear={IMPORTERS[kind].needsYear} years={years} defaultYearId={defaultYearId} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("exportTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("exportDescription")}</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-3">
          {(
            [
              ["students", t("exportStudents")],
              ["staff", t("exportStaff")],
              ["parents", t("exportParents")],
            ] as const
          ).map(([kind, label]) => (
            <div key={kind} className="flex items-center gap-2 text-sm">
              <span className="font-medium">{label}:</span>
              {(["csv", "xlsx"] as const).map((f) => (
                <a key={f} href={`/api/exports/${kind}?format=${f}`} download className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {t(f)}
                </a>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("history")}</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("when")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("fileName")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("result")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("view")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(j.createdAt, settings)}</TableCell>
                    <TableCell>{t(`kinds.${j.kind}`)}</TableCell>
                    <TableCell className="hidden max-w-[16rem] truncate md:table-cell">{j.fileName}</TableCell>
                    <TableCell>
                      <ImportStatusBadge status={j.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {j.status === "COMPLETED"
                        ? `+${formatNumber(j.createdRows, settings)} · ↻${formatNumber(j.updatedRows, settings)}${j.failedRows ? ` · ✕${formatNumber(j.failedRows, settings)}` : ""}`
                        : `${formatNumber(j.validRows, settings)} / ${formatNumber(j.totalRows, settings)}`}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/imports/${j.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                        {t("view")}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
