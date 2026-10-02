"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";
import { Input } from "@educore/ui/input";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { feeItemSchema, type FeeItemFormInput } from "@/lib/validation/fees";
import { createFeeItem, deleteFeeItem, moveFeeItem, updateFeeItem } from "../actions";

type Item = { id: string; name: string; description: string; isOptional: boolean; isOneOff: boolean; isActive: boolean };

export function NewFeeItemButton() {
  const t = useTranslations("fees.items");
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
      {(close) => <FeeItemForm onDone={close} />}
    </FormDialog>
  );
}

export function FeeItemRowActions({ item, isFirst, isLast }: { item: Item; isFirst: boolean; isLast: boolean }) {
  const t = useTranslations("fees.items");
  const tc = useTranslations("common");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [, startTransition] = React.useTransition();
  const move = (direction: "up" | "down") =>
    startTransition(async () => {
      const result = await moveFeeItem(item.id, direction);
      if (!result.ok) toast.error(result.error);
    });

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${tc("more")}: ${item.name}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {tc("edit")}
          </DropdownMenuItem>
          {!isFirst ? (
            <DropdownMenuItem onSelect={() => move("up")}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
              {t("moveUp")}
            </DropdownMenuItem>
          ) : null}
          {!isLast ? (
            <DropdownMenuItem onSelect={() => move("down")}>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
              {t("moveDown")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {tc("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FormDialog title={t("edit")} open={editing} onOpenChange={setEditing}>
        {(close) => <FeeItemForm item={item} onDone={close} />}
      </FormDialog>
      <ConfirmAction
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteTitle", { name: item.name })}
        description={t("deleteDescription")}
        confirmLabel={tc("delete")}
        action={() => deleteFeeItem(item.id)}
        successMessage={t("deleted")}
      />
    </div>
  );
}

const Check = React.forwardRef<HTMLInputElement, { id: string; label: string; hint: string } & React.InputHTMLAttributes<HTMLInputElement>>(
  function Check({ id, label, hint, ...props }, ref) {
    return (
      <div className="flex items-start gap-3">
        <input ref={ref} id={id} type="checkbox" className="mt-1 h-4 w-4 accent-primary" aria-describedby={`${id}-hint`} {...props} />
        <div>
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        </div>
      </div>
    );
  },
);

function FeeItemForm({ item, onDone }: { item?: Item; onDone: () => void }) {
  const t = useTranslations("fees.items");
  const { form, onSubmit, pending, fieldError } = useServerForm<FeeItemFormInput>({
    schema: feeItemSchema,
    defaultValues: {
      name: item?.name ?? "",
      description: item?.description ?? "",
      isOptional: item?.isOptional ?? false,
      isOneOff: item?.isOneOff ?? false,
      isActive: item?.isActive ?? true,
    },
    submit: (values) => (item ? updateFeeItem(item.id, values) : createFeeItem(values)),
    successMessage: item ? t("updated") : t("created"),
    onSuccess: onDone,
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={t("name")} htmlFor="fee-item-name" error={fieldError("name")} required>
        <Input placeholder={t("namePlaceholder")} autoFocus maxLength={80} {...form.register("name")} />
      </FormField>
      <FormField label={t("descriptionLabel")} htmlFor="fee-item-description" error={fieldError("description")}>
        <Input maxLength={200} {...form.register("description")} />
      </FormField>
      <fieldset className="space-y-3">
        <legend className="sr-only">{t("type")}</legend>
        <Check id="fee-item-optional" label={t("optionalLabel")} hint={t("optionalHint")} {...form.register("isOptional")} />
        <Check id="fee-item-oneoff" label={t("oneOffLabel")} hint={t("oneOffHint")} {...form.register("isOneOff")} />
        <Check id="fee-item-active" label={t("activeLabel")} hint={t("activeHint")} {...form.register("isActive")} />
      </fieldset>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}
