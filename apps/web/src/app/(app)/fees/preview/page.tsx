import { CalendarRange, Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ParamSelect } from "@/components/list/param-select";
import { billFor, feeTerms } from "@/lib/fees-data";
import { formatMoney } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";

type SP = { term?: string | string[]; section?: string | string[]; student?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Bill preview (milestone 3.0): exactly what a student would be charged for
 * a term — schedule, sign-ups, one-off items and discounts — before any
 * invoice exists. Uses the same maths invoicing will (lib/fees.ts).
 */
export default async function BillPreviewPage({ searchParams }: { searchParams: SP }) {
  const { user, db } = await requirePermission("feeStructure", "read", { page: true });
  const [t, settings] = await Promise.all([getTranslations("fees.preview"), getSettingsForUser(user.tenantId ?? null)]);
  const { terms, selected: term } = await feeTerms(db, settings.timezone, first(searchParams.term));
  if (!term) return <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noTermsTitle")} description={t("noTermsDescription")} />;

  const sections = await db.section.findMany({
    where: { class: { academicYearId: term.academicYearId }, students: { some: { status: "ACTIVE" } } },
    orderBy: [{ class: { order: "asc" } }, { class: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, class: { select: { name: true } } },
  });
  const section = sections.find((s) => s.id === first(searchParams.section)) ?? sections[0];
  const students = section
    ? await db.student.findMany({
        where: { sectionId: section.id, status: "ACTIVE" },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, firstName: true, lastName: true, admissionNo: true },
      })
    : [];
  const student = students.find((s) => s.id === first(searchParams.student)) ?? students[0];
  const bill = student ? await billFor(db, student.id, term) : null;
  const money = (minor: number) => formatMoney(minor / 100, settings);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <ParamSelect param="term" label={t("term")} options={terms.map((x) => ({ value: x.id, label: x.name }))} selected={term.id} />
        {section ? (
          <ParamSelect param="section" label={t("section")} options={sections.map((s) => ({ value: s.id, label: `${s.class.name} ${s.name}` }))} selected={section.id} />
        ) : null}
        {student ? (
          <ParamSelect
            param="student"
            label={t("student")}
            options={students.map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName} (${s.admissionNo})` }))}
            selected={student.id}
          />
        ) : null}
      </div>

      {!student ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title={t("noStudentsTitle")} description={t("noStudentsDescription", { year: term.yearName })} />
      ) : !bill || bill.lines.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-6 w-6" />}
          title={t("nothingTitle", { name: student.firstName, term: term.name })}
          description={t("nothingDescription")}
        />
      ) : (
        <section aria-labelledby="bill-heading" className="max-w-2xl space-y-3">
          <h2 id="bill-heading" className="text-lg font-semibold">
            {t("billTitle", { name: `${student.firstName} ${student.lastName}`, term: term.name })}
          </h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("line")}</TableHead>
                  <TableHead className="text-right">{t("amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.lines.map((line) => (
                  <TableRow key={line.kind === "FEE" ? `f:${line.feeTypeId}` : `d:${line.discountId}`}>
                    <TableCell className={line.kind === "DISCOUNT" ? "text-muted-foreground" : undefined}>
                      {line.kind === "DISCOUNT" ? t("discountLine", { name: line.description }) : line.description}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(line.amountMinor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                {bill.discountMinor > 0 ? (
                  <>
                    <TableRow>
                      <TableCell>{t("subtotal")}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(bill.subtotalMinor)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>{t("discounts")}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(-bill.discountMinor)}</TableCell>
                    </TableRow>
                  </>
                ) : null}
                <TableRow>
                  <TableCell className="font-semibold">{t("total")}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(bill.totalMinor)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          {bill.skipped.length || bill.unusedDiscounts.length ? (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {bill.skipped.map((s) => (
                <li key={s.feeTypeId}>{t(`skipped.${s.reason}`, { item: s.name })}</li>
              ))}
              {bill.unusedDiscounts.map((d) => (
                <li key={d.id}>{t("unusedDiscount", { name: d.name })}</li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </div>
  );
}
