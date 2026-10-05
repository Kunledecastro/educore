"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { newPasswordSchema, type NewPasswordInput } from "@/lib/validation/people";
import { changeOwnPasswordAction } from "./actions";

export function ChangePasswordForm({ username }: { username: string }) {
  const t = useTranslations("changePassword");
  const router = useRouter();
  const { form, onSubmit, pending, fieldError } = useServerForm<NewPasswordInput>({
    schema: newPasswordSchema,
    defaultValues: { password: "", confirm: "" },
    submit: (v) => changeOwnPasswordAction(v),
    successMessage: t("done"),
    onSuccess: () => {
      router.push("/dashboard");
      router.refresh();
    },
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <input type="text" autoComplete="username" value={username} readOnly hidden />
      <FormField label={t("password")} htmlFor="cp-password" hint={t("passwordHint")} error={fieldError("password")} required>
        <Input id="cp-password" type="password" autoComplete="new-password" autoFocus {...form.register("password")} />
      </FormField>
      <FormField label={t("confirm")} htmlFor="cp-confirm" error={fieldError("confirm")} required>
        <Input id="cp-confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
      </FormField>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
