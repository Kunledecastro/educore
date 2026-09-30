import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { PageHeader } from "@/components/page-header";
import { mergeCounts } from "@/lib/attendance";
import { attendanceSummaries, loadRegisterSection, sectionStudents } from "@/lib/attendance-data";
import { formatDateOnly, formatNumber, todayInTimeZone } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { NotFoundError } from "@/lib/run-action";
import { getSettingsForUser } from "@/lib/tenant";
import { resolveTermRange } from "@/lib/term-range";
import { TermSwitcher } from "@/components/list/term-switcher";

export default async function AttendanceSummaryPage({
  params,
  searchParams,
}: {
  params: { sectionId: string };
  searchParams: { term?: string | string[] };
}) {
  const ctx = await requireUser();
  const { user, db } = ctx;
  if (ctx.isPlatformAdmin || !can(user.role, "attendance", "read")) redirect("/attendance");
  const section = await loadRegisterSection(ctx, params.sectionId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const [t, settings] = await Promise.all([getTranslations("attendance"), getSettingsForUser(user.tenantId ?? null)]);
  const year = section.class.academicYear;
  const range = await resolveTermRange(db, year, searchParams.term, todayInTimeZone(settings.timezone));
  const students = await sectionStudents(db, section.id);
  const summaries = await attendanceSummaries(db, students.map((s) => s.id), range);
  const label = `${section.class.name} ${section.name}`;
  const pct = (n: number | null) => (n === null ? "—" : `${formatNumber(n, settings)}%`);

  const totals = mergeCounts([...summaries.values()]);
  const exportQuery = `sectionId=${section.id}${range.term ? `&term=${range.term.id}` : ""}`;

  return (
    <div>
      <Link href="/attendance" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-3 mb-2" })}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("backToAll")}
      </Link>
      <PageHeader
        title={t("summaryTitle", { section: label })}
        description={t("summaryRange", { label: range.label, from: formatDateOnly(range.from, settings), to: formatDateOnly(range.to, settings) })}
        actions={
          can(user.role, "attendance", "export") ? (
            <>
              <a href={`/api/exports/attendance?${exportQuery}&format=csv`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("exportCsv")}
              </a>
              <a href={`/api/exports/attendance?${exportQuery}&format=xlsx`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("exportXlsx")}
              </a>
            </>
          ) : undefined
        }
      />
      {range.terms.length > 0 ? (
        <div className="mb-4">
          <TermSwitcher terms={range.terms.map((x) => ({ id: x.id, name: x.name }))} selectedId={range.term?.id ?? ""} />
        </div>
      ) : null}
      <p className="mb-4 text-xs text-muted-foreground">{t("rateExplained")}</p>

      {students.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title={t("noStudents")} description={t("noStudentsHint")} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("student")}</TableHead>
                <TableHead className="text-right">{t("status.PRESENT")}</TableHead>
                <TableHead className="text-right">{t("status.ABSENT")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t("status.LATE")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t("status.EXCUSED")}</TableHead>
                <TableHead className="text-right">{t("rate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => {
                const c = summaries.get(s.id)!;
                const low = c.rate !== null && c.rate < 90;
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/students/${s.id}`} className="font-medium hover:underline">
                        {s.lastName}, {s.firstName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{s.admissionNo}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.present}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.absent}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{c.late}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{c.excused}</TableCell>
                    <TableCell className={`text-right tabular-nums ${low ? "font-semibold text-destructive" : ""}`}>
                      {pct(c.rate)}
                      {low ? <span className="sr-only"> ({t("belowNinety")})</span> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/40 font-medium">
                <TableCell>{t("sectionTotal")}</TableCell>
                <TableCell className="text-right tabular-nums">{totals.present}</TableCell>
                <TableCell className="text-right tabular-nums">{totals.absent}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{totals.late}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{totals.excused}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(totals.rate)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
