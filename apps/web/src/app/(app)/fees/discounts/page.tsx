import { BadgePercent, CalendarRange } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { AssignDiscountButton, DiscountRowActions, NewDiscountButton, RemoveAssignmentButton } from "./discount-actions";

/**
 * Discounts (milestone 3.0): the school's named discounts, and which
 * students get them this year — for one term or the whole year.
 */
export default async function DiscountsPage() {
  const { user, db } = await requirePermission("feeStructure", "read");
  const [t, settings] = await Promise.all([getTranslations("fees.discounts"), getSettingsForUser(user.tenantId ?? null)]);
  const canEdit = can(user.role, "feeStructure", "update");

  const [discounts, items, year] = await Promise.all([
    db.discount.findMany({
      orderBy: { name: "asc" },
      include: { feeType: { select: { name: true } }, _count: { select: { students: true } } },
    }),
    db.feeType.findMany({ where: { isActive: true }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.academicYear.findFirst({ where: { isActive: true }, include: { terms: { orderBy: { order: "asc" }, select: { id: true, name: true } } } }),
  ]);

  const describe = (d: (typeof discounts)[number]) =>
    d.kind === "PERCENT" ? t("percentValue", { value: formatNumber(d.value, settings) }) : formatMoney(d.value, settings);

  const assignments = year
    ? await db.studentDiscount.findMany({
        where: { academicYearId: year.id },
        include: {
          discount: { select: { name: true } },
          term: { select: { name: true } },
          student: { select: { firstName: true, lastName: true, admissionNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
        },
        orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
      })
    : [];

  const [sections, students] = year && canEdit
    ? await Promise.all([
        db.section.findMany({
          where: { class: { academicYearId: year.id } },
          orderBy: [{ class: { order: "asc" } }, { class: { name: "asc" } }, { name: "asc" }],
          select: { id: true, name: true, class: { select: { name: true } } },
        }),
        db.student.findMany({
          where: { status: "ACTIVE", academicYearId: year.id, sectionId: { not: null } },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: { id: true, firstName: true, lastName: true, admissionNo: true, sectionId: true },
        }),
      ])
    : [[], []];

  const discountOptions = discounts.filter((d) => d.isActive).map((d) => ({ id: d.id, label: `${d.name} (${describe(d)})` }));

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="discount-types">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="discount-types" className="text-lg font-semibold">
              {t("typesTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("typesIntro")}</p>
          </div>
          {canEdit && discounts.length > 0 ? <NewDiscountButton items={items} /> : null}
        </div>
        {discounts.length === 0 ? (
          <EmptyState
            icon={<BadgePercent className="h-6 w-6" />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            action={canEdit ? <NewDiscountButton items={items} /> : undefined}
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("value")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("appliesTo")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("students")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {discounts.map((d) => (
                  <TableRow key={d.id} className={d.isActive ? undefined : "opacity-60"}>
                    <TableCell className="font-medium">
                      {d.name} {!d.isActive ? <Badge variant="outline">{t("inactive")}</Badge> : null}
                      <div className="text-xs font-normal text-muted-foreground sm:hidden">{d.feeType ? d.feeType.name : t("wholeBill")}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{describe(d)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{d.feeType ? d.feeType.name : t("wholeBill")}</TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">{d._count.students}</TableCell>
                    <TableCell>
                      {canEdit ? (
                        <DiscountRowActions
                          items={items}
                          discount={{ id: d.id, name: d.name, kind: d.kind, value: d.value.toString(), feeTypeId: d.feeTypeId ?? "", isActive: d.isActive }}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="discount-students">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="discount-students" className="text-lg font-semibold">
              {year ? t("assignedTitle", { year: year.name }) : t("assignedTitleNoYear")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("assignedIntro")}</p>
          </div>
          {canEdit && year && discountOptions.length > 0 && students.length > 0 ? (
            <AssignDiscountButton
              academicYearId={year.id}
              terms={year.terms}
              discounts={discountOptions}
              sections={sections.map((s) => ({ id: s.id, label: `${s.class.name} ${s.name}` }))}
              students={students.map((s) => ({ id: s.id, sectionId: s.sectionId!, label: `${s.lastName}, ${s.firstName} (${s.admissionNo})` }))}
            />
          ) : null}
        </div>
        {!year ? (
          <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noYearTitle")} description={t("noYearDescription")} />
        ) : assignments.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{discounts.length ? t("noneAssigned") : t("createFirst")}</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("student")}</TableHead>
                  <TableHead>{t("discount")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("period")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("note")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a) => {
                  const name = `${a.student.firstName} ${a.student.lastName}`;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <span className="font-medium">{name}</span>
                        <div className="text-xs text-muted-foreground">
                          {a.student.admissionNo}
                          {a.student.section ? ` · ${a.student.section.class.name} ${a.student.section.name}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        {a.discount.name}
                        <div className="text-xs text-muted-foreground sm:hidden">{a.term ? a.term.name : t("wholeYear")}</div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{a.term ? a.term.name : t("wholeYear")}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{a.note}</TableCell>
                      <TableCell>
                        {canEdit ? <RemoveAssignmentButton id={a.id} student={name} discount={a.discount.name} /> : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
