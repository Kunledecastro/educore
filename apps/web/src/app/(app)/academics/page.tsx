import { CalendarRange } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { formatDateOnly, formatNumber } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { toDateInput } from "@/lib/validation/common";
import { NewYearButton, YearRowActions } from "./year-actions";

export default async function AcademicYearsPage() {
  const { user, db } = await requirePermission("academicYear", "read");
  const [t, settings] = await Promise.all([getTranslations("academics.years"), getSettingsForUser(user.tenantId ?? null)]);

  const years = await db.academicYear.findMany({
    orderBy: { startDate: "desc" },
    include: { _count: { select: { classes: true, students: true } } },
  });

  if (years.length === 0) {
    return (
      <EmptyState
        icon={<CalendarRange className="h-6 w-6" />}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        action={<NewYearButton first />}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewYearButton />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("startDate")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("endDate")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead className="hidden md:table-cell text-right">{t("classes")}</TableHead>
              <TableHead className="hidden md:table-cell text-right">{t("students")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("status")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((y) => (
              <TableRow key={y.id}>
                <TableCell className="font-medium">
                  {y.name}
                  <div className="text-xs text-muted-foreground sm:hidden">
                    {formatDateOnly(y.startDate, settings)} – {formatDateOnly(y.endDate, settings)}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{formatDateOnly(y.startDate, settings)}</TableCell>
                <TableCell className="hidden sm:table-cell">{formatDateOnly(y.endDate, settings)}</TableCell>
                <TableCell>
                  {y.isActive ? <Badge variant="success">{t("active")}</Badge> : <Badge variant="outline">{t("inactive")}</Badge>}
                </TableCell>
                <TableCell className="hidden md:table-cell text-right tabular-nums">{formatNumber(y._count.classes, settings)}</TableCell>
                <TableCell className="hidden md:table-cell text-right tabular-nums">{formatNumber(y._count.students, settings)}</TableCell>
                <TableCell>
                  <YearRowActions
                    year={{
                      id: y.id,
                      name: y.name,
                      isActive: y.isActive,
                      // Date-only values are stored at UTC midnight; format in UTC so the day never shifts.
                      startDate: toDateInput(y.startDate),
                      endDate: toDateInput(y.endDate),
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
