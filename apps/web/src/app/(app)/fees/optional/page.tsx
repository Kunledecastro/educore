import Link from "next/link";
import { Bus, CalendarRange } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { ParamSelect } from "@/components/list/param-select";
import { feeTerms } from "@/lib/fees-data";
import { formatMoney } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { SignupsEditor } from "./signups-editor";

type SP = { term?: string | string[]; item?: string | string[]; section?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Optional items (bus, lunch…): tick who's signed up, per class and term (milestone 3.0). */
export default async function OptionalFeesPage({ searchParams }: { searchParams: SP }) {
  const { user, db } = await requirePermission("feeStructure", "read");
  const [t, settings] = await Promise.all([getTranslations("fees.optional"), getSettingsForUser(user.tenantId ?? null)]);
  const { terms, selected: term } = await feeTerms(db, settings.timezone, first(searchParams.term));
  const items = await db.feeType.findMany({ where: { isOptional: true, isActive: true }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } });

  if (!term) return <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noTermsTitle")} description={t("noTermsDescription")} />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Bus className="h-6 w-6" />}
        title={t("noItemsTitle")}
        description={t("noItemsDescription")}
        action={
          <Link href="/fees/items" className={buttonVariants()}>
            {t("goToItems")}
          </Link>
        }
      />
    );
  }

  const sections = await db.section.findMany({
    where: { class: { academicYearId: term.academicYearId } },
    orderBy: [{ class: { order: "asc" } }, { class: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, classId: true, class: { select: { name: true } } },
  });
  const item = items.find((i) => i.id === first(searchParams.item)) ?? items[0]!;
  const section = sections.find((s) => s.id === first(searchParams.section)) ?? sections[0];

  const filters = (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <ParamSelect param="term" label={t("term")} options={terms.map((x) => ({ value: x.id, label: x.name }))} selected={term.id} />
      <ParamSelect param="item" label={t("item")} options={items.map((x) => ({ value: x.id, label: x.name }))} selected={item.id} />
      {section ? (
        <ParamSelect param="section" label={t("section")} options={sections.map((s) => ({ value: s.id, label: `${s.class.name} ${s.name}` }))} selected={section.id} />
      ) : null}
    </div>
  );

  if (!section) {
    return (
      <div className="space-y-4">
        {filters}
        <EmptyState icon={<Bus className="h-6 w-6" />} title={t("noSectionsTitle")} description={t("noSectionsDescription", { year: term.yearName })} />
      </div>
    );
  }

  const [students, signups, price] = await Promise.all([
    db.student.findMany({
      where: { sectionId: section.id, status: "ACTIVE" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, admissionNo: true },
    }),
    db.feeSignup.findMany({ where: { termId: term.id, feeTypeId: item.id, student: { sectionId: section.id } }, select: { studentId: true } }),
    db.feeStructure.findFirst({ where: { termId: term.id, feeTypeId: item.id, classId: section.classId }, select: { amount: true } }),
  ]);
  const sectionLabel = `${section.class.name} ${section.name}`;

  return (
    <div className="space-y-4">
      {filters}
      <p className="text-sm text-muted-foreground">
        {price
          ? t("price", { item: item.name, class: section.class.name, term: term.name, amount: formatMoney(price.amount, settings) })
          : t("noPrice", { item: item.name, class: section.class.name, term: term.name })}
      </p>
      {students.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("noStudents", { section: sectionLabel })}</p>
      ) : (
        <SignupsEditor
          key={`${term.id}:${item.id}:${section.id}`}
          termId={term.id}
          feeTypeId={item.id}
          sectionId={section.id}
          caption={t("caption", { item: item.name, section: sectionLabel, term: term.name })}
          students={students.map((s) => ({ id: s.id, name: `${s.lastName}, ${s.firstName}`, admissionNo: s.admissionNo }))}
          signedUp={signups.map((s) => s.studentId)}
          readOnly={!can(user.role, "feeStructure", "update")}
        />
      )}
    </div>
  );
}
