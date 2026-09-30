import Link from "next/link";
import { CalendarDays, CalendarRange } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { YearSwitcher } from "@/components/list/year-switcher";
import { resolveAcademicYear } from "@/lib/academic-year";
import { formatDateOnly } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { toDateInput } from "@/lib/validation/common";
import { AddSuggestedTermsButton, NewTermButton, TermRowActions } from "./term-actions";

export default async function TermsPage({ searchParams }: { searchParams: { year?: string | string[] } }) {
  const { user, db } = await requirePermission("academicSettings", "read");
  const [t, settings] = await Promise.all([getTranslations("settings.terms"), getSettingsForUser(user.tenantId ?? null)]);
  const { years, selected } = await resolveAcademicYear(db, searchParams.year);

  if (!selected) {
    return (
      <EmptyState
        icon={<CalendarRange className="h-6 w-6" />}
        title={t("noYearTitle")}
        description={t("noYearDescription")}
        action={
          <Link href="/academics" className={buttonVariants()}>
            {t("goToYears")}
          </Link>
        }
      />
    );
  }

  const terms = await db.term.findMany({ where: { academicYearId: selected.id }, orderBy: { order: "asc" } });
  const year = { id: selected.id, name: selected.name, startDate: toDateInput(selected.startDate), endDate: toDateInput(selected.endDate) };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <YearSwitcher years={years.map(({ id, name, isActive }) => ({ id, name, isActive }))} selectedId={selected.id} />
        {terms.length > 0 ? <NewTermButton year={year} /> : null}
      </div>

      {terms.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title={t("emptyTitle", { year: selected.name })}
          description={t("emptyDescription")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <AddSuggestedTermsButton yearId={selected.id} yearName={selected.name} />
              <NewTermButton year={year} variant="outline" />
            </div>
          }
        />
      ) : (
        <>
          {!selected.isActive ? <p className="text-sm text-muted-foreground">{t("inactiveYearNote")}</p> : null}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("startDate")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("endDate")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terms.map((term) => (
                  <TableRow key={term.id}>
                    <TableCell className="font-medium">
                      {term.name}
                      <div className="text-xs text-muted-foreground sm:hidden">
                        {formatDateOnly(term.startDate, settings)} – {formatDateOnly(term.endDate, settings)}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDateOnly(term.startDate, settings)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDateOnly(term.endDate, settings)}</TableCell>
                    <TableCell>{term.isCurrent ? <Badge variant="success">{t("current")}</Badge> : null}</TableCell>
                    <TableCell>
                      <TermRowActions
                        year={year}
                        canSetCurrent={selected.isActive && !term.isCurrent}
                        term={{ id: term.id, name: term.name, startDate: toDateInput(term.startDate), endDate: toDateInput(term.endDate) }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
