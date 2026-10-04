"use client";

import * as React from "react";
import { CreditCard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { startOnlinePaymentAction } from "@/app/(app)/fees/online-actions";
import { onlinePaymentSchema, type OnlinePaymentInput } from "@/lib/validation/fees";

/** "Pay online": choose the amount (full balance by default), then off to Paystack's secure checkout. */
export function PayOnlineButton({ invoiceId, invoiceNo, balance, balanceLabel, size = "default" }: { invoiceId: string; invoiceNo: string; balance: string; balanceLabel: string; size?: "default" | "sm" }) {
  const t = useTranslations("fees.online");
  return (
    <FormDialog
      title={t("title", { number: invoiceNo })}
      trigger={
        <Button size={size}>
          <CreditCard className="h-4 w-4" aria-hidden="true" />
          {t("pay")}
        </Button>
      }
    >
      {(close) => <PayForm invoiceId={invoiceId} balance={balance} balanceLabel={balanceLabel} onDone={close} />}
    </FormDialog>
  );
}

function PayForm({ invoiceId, balance, balanceLabel, onDone }: { invoiceId: string; balance: string; balanceLabel: string; onDone: () => void }) {
  const t = useTranslations("fees.online");
  const [leaving, setLeaving] = React.useState(false);
  const { form, onSubmit, pending, fieldError } = useServerForm<OnlinePaymentInput>({
    schema: onlinePaymentSchema,
    defaultValues: { invoiceId, amount: balance.replace(/\.00$/, "") },
    submit: async (values) => {
      const result = await startOnlinePaymentAction(values);
      if (result.ok) {
        setLeaving(true);
        window.location.assign((result.data as { url: string }).url);
      }
      return result;
    },
    successMessage: t("redirecting"),
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" {...form.register("invoiceId")} />
      <FormField label={t("amount")} htmlFor="online-amount" error={fieldError("amount")} hint={t("amountHint", { balance: balanceLabel })} required>
        <Input inputMode="decimal" autoComplete="off" autoFocus {...form.register("amount")} />
      </FormField>
      <p className="text-sm text-muted-foreground">{t("explain")}</p>
      <FormDialogFooter pending={pending || leaving} onCancel={onDone} submitLabel={leaving ? t("redirecting") : t("continue")} />
    </form>
  );
}
