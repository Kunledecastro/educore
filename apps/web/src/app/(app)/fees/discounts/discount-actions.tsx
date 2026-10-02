"use client";

import * as React from "react";
import { MoreHorizontal, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { discountSchema, studentDiscountSchema, type DiscountFormInput, type StudentDiscountFormInput } from "@/lib/validation/fees";
import { assignDiscount, createDiscount, deleteDiscount, removeStudentDiscount, updateDiscount } from "../actions";

type ItemOption = { id: string; name: string };
type DiscountInfo = { id: string; name: string; kind: "PERCENT" | "FIXED"; value: string; feeTypeId: string; isActive: boolean };

const trimZeros = (v: string) => (v.includes(".") ? v.replace(/\.?0+$/, "") : v);

export function NewDiscountButton({ items }: { items: ItemOption[] }) {
  const t = useTranslations("fees.discounts");
  return (
    <FormDialog
      title={t("new")}
      trigger={
        <Button>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Button>
      }
    >
      {(close) => <DiscountForm items={items} onDone={close} />}
    </FormDialog>
  );
}

export function DiscountRowActions({ discount, items }: { discount: DiscountInfo; items: ItemOption[] }) {
  const t = useTranslations("fees.discounts");
  const tc = useTranslations("common");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${tc("more")}: ${discount.name}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {tc("edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {tc("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog title={t("edit")} open={editing} onOpenChange={setEditing}>
        {(close) => <DiscountForm items={items} discount={discount} onDone={close} />}
      </FormDialog>
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteTitle", { name: discount.name })}
        description={t("deleteDescription")}
        confirmLabel={tc("delete")}
        action={() => deleteDiscount(discount.id)}
        successMessage={t("deleted")}
      />
    </div>
  );
}

function DiscountForm({ items, discount, onDone }: { items: ItemOption[]; discount?: DiscountInfo; onDone: () => void }) {
  const t = useTranslations("fees.discounts");
  const { form, onSubmit, pending, fieldError } = useServerForm<DiscountFormInput>({
    schema: discountSchema,
    defaultValues: {
      name: discount?.name ?? "",
      kind: discount?.kind ?? "PERCENT",
      value: discount ? trimZeros(discount.value) : "",
      feeTypeId: discount?.feeTypeId ?? "",
      isActive: discount?.isActive ?? true,
    },
    submit: (values) => (discount ? updateDiscount(discount.id, values) : createDiscount(values)),
    successMessage: discount ? t("updated") : t("created"),
    onSuccess: onDone,
  });
  const kind = form.watch("kind");

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={t("name")} htmlFor="discount-name" error={fieldError("name")} required>
        <Input placeholder={t("namePlaceholder")} autoFocus maxLength={80} {...form.register("name")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("kind")} htmlFor="discount-kind" error={fieldError("kind")} required>
          <Select {...form.register("kind")}>
            <option value="PERCENT">{t("kindPercent")}</option>
            <option value="FIXED">{t("kindFixed")}</option>
          </Select>
        </FormField>
        <FormField
          label={kind === "PERCENT" ? t("valuePercent") : t("valueFixed")}
          htmlFor="discount-value"
          error={fieldError("value")}
          hint={kind === "PERCENT" ? t("valuePercentHint") : t("valueFixedHint")}
          required
        >
          <Input inputMode="decimal" autoComplete="off" {...form.register("value")} />
        </FormField>
      </div>
      <FormField label={t("appliesTo")} htmlFor="discount-item" error={fieldError("feeTypeId")} hint={t("appliesToHint")}>
        <Select {...form.register("feeTypeId")}>
          <option value="">{t("wholeBill")}</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
      </FormField>
      <label className="flex items-start gap-3" htmlFor="discount-active">
        <input id="discount-active" type="checkbox" className="mt-1 h-4 w-4 accent-primary" {...form.register("isActive")} />
        <span>
          <span className="text-sm font-medium">{t("activeLabel")}</span>
          <span className="block text-xs text-muted-foreground">{t("activeHint")}</span>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">{t("futureOnly")}</p>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}

export function AssignDiscountButton({
  academicYearId,
  terms,
  discounts,
  sections,
  students,
}: {
  academicYearId: string;
  terms: { id: string; name: string }[];
  discounts: { id: string; label: string }[];
  sections: { id: string; label: string }[];
  students: { id: string; sectionId: string; label: string }[];
}) {
  const t = useTranslations("fees.discounts");
  return (
    <FormDialog
      title={t("assign")}
      trigger={
        <Button variant="outline">
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {t("assign")}
        </Button>
      }
    >
      {(close) => <AssignForm academicYearId={academicYearId} terms={terms} discounts={discounts} sections={sections} students={students} onDone={close} />}
    </FormDialog>
  );
}

function AssignForm({
  academicYearId,
  terms,
  discounts,
  sections,
  students,
  onDone,
}: {
  academicYearId: string;
  terms: { id: string; name: string }[];
  discounts: { id: string; label: string }[];
  sections: { id: string; label: string }[];
  students: { id: string; sectionId: string; label: string }[];
  onDone: () => void;
}) {
  const t = useTranslations("fees.discounts");
  const withStudents = sections.filter((s) => students.some((st) => st.sectionId === s.id));
  const [sectionId, setSectionId] = React.useState(withStudents[0]?.id ?? "");
  const inSection = students.filter((s) => s.sectionId === sectionId);
  const { form, onSubmit, pending, fieldError } = useServerForm<StudentDiscountFormInput>({
    schema: studentDiscountSchema,
    defaultValues: { academicYearId, studentId: inSection[0]?.id ?? "", discountId: discounts[0]?.id ?? "", termId: "", note: "" },
    submit: (values) => assignDiscount(values),
    successMessage: t("assigned"),
    onSuccess: onDone,
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" {...form.register("academicYearId")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="assign-section" className="text-sm font-medium">
            {t("classSection")}
          </label>
          <Select
            id="assign-section"
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
              form.setValue("studentId", students.find((s) => s.sectionId === e.target.value)?.id ?? "");
            }}
          >
            {withStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <FormField label={t("student")} htmlFor="assign-student" error={fieldError("studentId")} required>
          <Select {...form.register("studentId")}>
            {inSection.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label={t("discount")} htmlFor="assign-discount" error={fieldError("discountId")} required>
        <Select {...form.register("discountId")}>
          {discounts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("period")} htmlFor="assign-term" error={fieldError("termId")} hint={t("periodHint")}>
        <Select {...form.register("termId")}>
          <option value="">{t("wholeYear")}</option>
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("note")} htmlFor="assign-note" error={fieldError("note")}>
        <Input maxLength={200} placeholder={t("notePlaceholder")} {...form.register("note")} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("assign")} />
    </form>
  );
}

export function RemoveAssignmentButton({ id, student, discount }: { id: string; student: string; discount: string }) {
  const t = useTranslations("fees.discounts");
  return (
    <div className="flex justify-end">
      <ConfirmAction
        trigger={
          <Button variant="ghost" size="icon" aria-label={t("removeLabel", { student, discount })}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        }
        title={t("removeTitle", { student, discount })}
        description={t("removeDescription")}
        confirmLabel={t("remove")}
        action={() => removeStudentDiscount(id)}
        successMessage={t("removed")}
      />
    </div>
  );
}
