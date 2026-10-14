"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { Textarea } from "@educore/ui/textarea";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormField } from "@/components/form/form-field";
import { day, workingDays } from "@/lib/leave/rules";
import { cancelLeaveAction, requestLeaveAction, withdrawLeaveAction } from "./actions";

/** Ask for leave: type, dates (working days shown as you pick), a note for the approver. */
export function RequestLeaveForm({ types }: { types: { id: string; name: string; left: number }[] }) {
  const t = useTranslations("leave");
  const tRoot = useTranslations();
  const router = useRouter();
  const [v, setV] = React.useState({ leaveTypeId: types[0]?.id ?? "", startDate: "", endDate: "", note: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, start] = React.useTransition();
  const days = v.startDate && v.endDate && v.endDate >= v.startDate ? workingDays(day(v.startDate), day(v.endDate)) : null;
  const chosen = types.find((x) => x.id === v.leaveTypeId);
  if (types.length === 0) return <p className="text-sm text-muted-foreground">{t("noTypes")}</p>;
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await requestLeaveAction(v);
          if (r.ok) {
            toast.success(tRoot("approvals.sentForApproval"));
            setV({ ...v, startDate: "", endDate: "", note: "" });
            setErrors({});
            router.refresh();
          } else {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
          }
        });
      }}
    >
      <FormField label={t("form.type")} htmlFor="lv-type" error={errors.leaveTypeId} required>
        <Select id="lv-type" value={v.leaveTypeId} onChange={(e) => setV({ ...v, leaveTypeId: e.target.value })}>
          {types.map((x) => (
            <option key={x.id} value={x.id}>
              {t("form.typeOption", { name: x.name, left: x.left })}
            </option>
          ))}
        </Select>
      </FormField>
      <div aria-live="polite" className="self-end pb-2 text-sm text-muted-foreground">
        {days !== null ? (days > (chosen?.left ?? 0) ? <span className="font-medium text-destructive">{t("form.overBalance", { count: days })}</span> : t("form.workingDays", { count: days })) : null}
      </div>
      <FormField label={t("form.from")} htmlFor="lv-from" error={errors.startDate} required>
        <Input id="lv-from" type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
      </FormField>
      <FormField label={t("form.to")} htmlFor="lv-to" error={errors.endDate} required>
        <Input id="lv-to" type="date" min={v.startDate || undefined} value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
      </FormField>
      <div className="sm:col-span-2">
        <FormField label={t("form.note")} htmlFor="lv-note" error={errors.note} hint={t("form.noteHint")}>
          <Textarea id="lv-note" rows={3} maxLength={300} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? tRoot("common.working") : t("form.submit")}
        </Button>
      </div>
    </form>
  );
}

export function WithdrawLeaveButton({ requestId }: { requestId: string }) {
  const t = useTranslations("leave");
  const router = useRouter();
  return (
    <ConfirmAction
      trigger={
        <Button type="button" variant="ghost" size="sm">
          {t("withdraw")}
        </Button>
      }
      title={t("withdrawTitle")}
      description={t("withdrawDescription")}
      confirmLabel={t("withdraw")}
      action={() => withdrawLeaveAction(requestId)}
      successMessage={t("withdrawn")}
      onSuccess={() => router.refresh()}
    />
  );
}

export function CancelLeaveButton({ leaveId, label }: { leaveId: string; label: string }) {
  const t = useTranslations("leave");
  const router = useRouter();
  return (
    <ConfirmAction
      trigger={
        <Button type="button" variant="ghost" size="sm">
          {t("cancel")}
        </Button>
      }
      title={t("cancelTitle", { label })}
      description={t("cancelDescription")}
      confirmLabel={t("cancel")}
      action={() => cancelLeaveAction(leaveId)}
      successMessage={t("cancelled")}
      onSuccess={() => router.refresh()}
    />
  );
}
