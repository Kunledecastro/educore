"use client";

import * as React from "react";
import { Ban, PlusCircle, Undo2, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import {
  adjustmentSchema,
  cancelInvoiceSchema,
  PAYMENT_METHODS,
  paymentSchema,
  reversalSchema,
  type AdjustmentInput,
  type CancelInvoiceInput,
  type PaymentFormInput,
  type ReversalInput,
} from "@/lib/validation/fees";
import { addAdjustmentAction, cancelInvoiceAction, recordPaymentAction, reversePaymentAction } from "../../invoice-actions";

export function RecordPaymentButton({ invoiceId, invoiceNo, balance, balanceLabel, today }: { invoiceId: string; invoiceNo: string; balance: string; balanceLabel: string; today: string }) {
  const t = useTranslations("fees.invoice");
  return (
    <FormDialog
      title={t("recordTitle", { number: invoiceNo })}
      trigger={
        <Button>
          <Wallet className="h-4 w-4" aria-hidden="true" />
          {t("record")}
        </Button>
      }
    >
      {(close) => <PaymentForm invoiceId={invoiceId} balance={balance} balanceLabel={balanceLabel} today={today} onDone={close} />}
    </FormDialog>
  );
}

function PaymentForm({ invoiceId, balance, balanceLabel, today, onDone }: { invoiceId: string; balance: string; balanceLabel: string; today: string; onDone: () => void }) {
  const t = useTranslations("fees.invoice");
  const { form, onSubmit, pending, fieldError } = useServerForm<PaymentFormInput>({
    schema: paymentSchema,
    defaultValues: { invoiceId, amount: balance.replace(/\.00$/, ""), method: "BANK_TRANSFER", paidAt: today, reference: "", note: "" },
    submit: (values) => recordPaymentAction(values),
    successMessage: t("recorded"),
    onSuccess: onDone,
  });
  const method = form.watch("method");
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" {...form.register("invoiceId")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("amount")} htmlFor="pay-amount" error={fieldError("amount")} hint={t("balanceHint", { balance: balanceLabel })} required>
          <Input inputMode="decimal" autoComplete="off" autoFocus {...form.register("amount")} />
        </FormField>
        <FormField label={t("paidOn")} htmlFor="pay-date" error={fieldError("paidAt")} required>
          <Input type="date" max={today} {...form.register("paidAt")} />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("method")} htmlFor="pay-method" error={fieldError("method")} required>
          <Select {...form.register("method")}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`methods.${m}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("reference")} htmlFor="pay-reference" error={fieldError("reference")} hint={method === "CASH" ? t("referenceOptional") : t("referenceHint")} required={method !== "CASH"}>
          <Input maxLength={80} autoComplete="off" {...form.register("reference")} />
        </FormField>
      </div>
      <FormField label={t("note")} htmlFor="pay-note" error={fieldError("note")}>
        <Input maxLength={300} {...form.register("note")} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("record")} />
    </form>
  );
}

export function AdjustmentButton({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("fees.invoice");
  return (
    <FormDialog
      title={t("adjustTitle")}
      trigger={
        <Button variant="outline" size="sm">
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          {t("adjust")}
        </Button>
      }
    >
      {(close) => <AdjustmentForm invoiceId={invoiceId} onDone={close} />}
    </FormDialog>
  );
}

function AdjustmentForm({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const t = useTranslations("fees.invoice");
  const { form, onSubmit, pending, fieldError } = useServerForm<AdjustmentInput>({
    schema: adjustmentSchema,
    defaultValues: { invoiceId, description: "", amount: "" },
    submit: (values) => addAdjustmentAction(values),
    successMessage: t("adjusted"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" {...form.register("invoiceId")} />
      <p className="text-sm text-muted-foreground">{t("adjustIntro")}</p>
      <FormField label={t("adjustDescription")} htmlFor="adj-description" error={fieldError("description")} required>
        <Input maxLength={120} autoFocus placeholder={t("adjustPlaceholder")} {...form.register("description")} />
      </FormField>
      <FormField label={t("adjustAmount")} htmlFor="adj-amount" error={fieldError("amount")} hint={t("adjustAmountHint")} required>
        <Input inputMode="decimal" autoComplete="off" {...form.register("amount")} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={t("adjust")} />
    </form>
  );
}

export function CancelInvoiceButton({ invoiceId, invoiceNo }: { invoiceId: string; invoiceNo: string }) {
  const t = useTranslations("fees.invoice");
  return (
    <FormDialog
      title={t("cancelTitle", { number: invoiceNo })}
      trigger={
        <Button variant="outline" size="sm" className="text-destructive">
          <Ban className="h-4 w-4" aria-hidden="true" />
          {t("cancel")}
        </Button>
      }
    >
      {(close) => <ReasonForm<CancelInvoiceInput> schema={cancelInvoiceSchema} defaults={{ invoiceId, reason: "" }} intro={t("cancelIntro")} submitLabel={t("cancelConfirm")} success={t("cancelled")} submit={cancelInvoiceAction} onDone={close} />}
    </FormDialog>
  );
}

export function ReversePaymentButton({ paymentId, receiptNo, amount }: { paymentId: string; receiptNo: string; amount: string }) {
  const t = useTranslations("fees.invoice");
  return (
    <FormDialog
      title={t("reverseTitle", { receipt: receiptNo, amount })}
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive" aria-label={t("reverseLabel", { receipt: receiptNo })}>
          <Undo2 className="h-4 w-4" aria-hidden="true" />
          <span className="hidden md:inline">{t("reverse")}</span>
        </Button>
      }
    >
      {(close) => <ReasonForm<ReversalInput> schema={reversalSchema} defaults={{ paymentId, reason: "" }} intro={t("reverseIntro")} submitLabel={t("reverseConfirm")} success={t("reversedDone")} submit={reversePaymentAction} onDone={close} />}
    </FormDialog>
  );
}

function ReasonForm<T extends { reason: string }>({
  schema,
  defaults,
  intro,
  submitLabel,
  success,
  submit,
  onDone,
}: {
  schema: typeof cancelInvoiceSchema | typeof reversalSchema;
  defaults: T;
  intro: string;
  submitLabel: string;
  success: string;
  submit: (values: T) => ReturnType<typeof cancelInvoiceAction>;
  onDone: () => void;
}) {
  const t = useTranslations("fees.invoice");
  const { form, onSubmit, pending, fieldError } = useServerForm<T>({
    schema,
    defaultValues: defaults as never,
    submit,
    successMessage: success,
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{intro}</p>
      <FormField label={t("reason")} htmlFor="reason" error={fieldError("reason" as never)} required>
        <Input maxLength={200} autoFocus {...form.register("reason" as never)} />
      </FormField>
      <FormDialogFooter pending={pending} onCancel={onDone} submitLabel={submitLabel} />
    </form>
  );
}
