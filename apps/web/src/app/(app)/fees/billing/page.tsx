import Link from "next/link";
import { CalendarRange, Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { ParamSelect } from "@/components/list/param-select";
import { billsFor, feeTerms } from "@/lib/fees-data";
import { toMinor } from "@/lib/fees";
import { formatDateTime, formatMoney, todayInTimeZone } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { toDateInput } from "@/lib/validation/common";
import { AutoRefresh } from "../../imports/[id]/report-controls";
import { BillingForm } from "./billing-form";

/**
 * Bill the term (milestone 3.1): per class, how many students still need an
 * invoice and what they'll be billed (the same billsFor() the background
 * run uses), then start the run and watch its progress.
 */
export default async function BillingPage({ searchParams }: { searchParams: { term?: string | string[] } }) {
  const { user, db } = await requirePermission("invoice", "create", { page: true });
  const [t, settings] = await Promise.all([getTranslations("fees.billing"), getSettingsForUser(user.tenantId ?? null)]);
  const requested = Array.isArray(searchParams.term) ? searchParams.term[0] : searchParams.term;
  const { terms, selected: term } = await feeTerms(db, settings.timezone, requested);
  if (!term) return <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noTermsTitle")} description={t("noTermsDescription")} />;

  const [termRow, classes, students, live, runs] = await Promise.all([
    db.term.findFirstOrThrow({ where: { id: term.id }, select: { startDate: true } }),
    db.classGrade.findMany({ where: { academicYearId: term.academicYearId }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.student.findMany({ where: { status: "ACTIVE", class: { academicYearId: term.academicYearId } }, select: { id: true, classId: true } }),
    db.invoice.findMany({ where: { termId: term.id, status: { not: "CANCELLED" } }, select: { studentId: true } }),
    db.billingRun.findMany({ where: { termId: term.id }, orderBy: { createdAt: "desc" }, take: 5, include: { createdBy: { select: { name: true } } } }),
  ]);
  const billed = new Set(live.map((l) => l.studentId));
  const toBill = students.filter((s) => !billed.has(s.id));
  const bills = await billsFor(db, term, toBill.map((s) => s.id));

  const rows = classes.map((c) => {
    const inClass = students.filter((s) => s.classId === c.id);
    const pending = toBill.filter((s) => s.classId === c.id);
    let amount = 0;
    let empty = 0;
    for (const s of pending) {
      const b = bills.get(s.id);
      if (!b || b.lines.length === 0) empty++;
      else amount += b.totalMinor;
    }
    return { id: c.id, name: c.name, students: inClass.length, billed: inClass.length - pending.length, toBill: pending.length - empty, noFees: empty, amountMinor: amount };
  });

  const today = todayInTimeZone(settings.timezone);
  const start = termRow.startDate > today ? termRow.startDate : today;
  const defaultDue = new Date(start.getTime() + settings.paymentTermDays * 86_400_000);
  const running = runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  const money = (minor: number) => formatMoney(minor / 100, settings);

  return (
    <div className="space-y-6">
      <AutoRefresh active={running} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ParamSelect param="term" label={t("term")} options={terms.map((x) => ({ value: x.id, label: x.name }))} selected={term.id} />
        <Link href={`/fees?term=${term.id}`} className={buttonVariants({ variant: "outline" })}>
          {t("viewInvoices")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro", { term: term.name })}</p>

      {classes.length === 0 ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title={t("noClassesTitle")} description={t("noClassesDescription", { year: term.yearName })} />
      ) : (
        <BillingForm
          key={term.id}
          termId={term.id}
          termName={term.name}
          defaultDueDate={toDateInput(defaultDue)}
          busy={running}
          classes={rows.map((r) => ({ ...r, amount: money(r.amountMinor) }))}
          currency={settings.currency}
          locale={settings.locale}
        />
      )}

      {runs.length > 0 ? (
        <section aria-labelledby="runs-heading" className="space-y-3">
          <h2 id="runs-heading" className="text-lg font-semibold">
            {t("runsTitle")}
          </h2>
          <ul className="space-y-2">
            {runs.map((run) => {
              const pct = run.total ? Math.round((run.done / run.total) * 100) : run.status === "COMPLETED" ? 100 : 0;
              return (
                <li key={run.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">
                      {t("runBy", { name: run.createdBy?.name ?? "—", when: formatDateTime(run.createdAt, settings) })}
                    </span>
                    <Badge variant={run.status === "COMPLETED" ? "success" : run.status === "FAILED" ? "destructive" : "secondary"}>{t(`runStatus.${run.status}`)}</Badge>
                  </div>
                  {run.status === "RUNNING" || run.status === "QUEUED" ? (
                    <div className="mt-2">
                      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("progressLabel")}>
                        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{t("progress", { done: run.done, total: run.total })}</p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {run.status === "FAILED"
                        ? t("runFailed")
                        : t("runResult", { created: run.created, skipped: run.skipped, amount: money(toMinor(run.amount) ?? 0) })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
