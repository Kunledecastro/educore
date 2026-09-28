"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { newPasswordSchema, type NewPasswordInput } from "@/lib/validation/people";
import { acceptInvite } from "./actions";

export function SetPasswordForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations("invitePage");
  const router = useRouter();
  const { form, onSubmit, pending, fieldError } = useServerForm<NewPasswordInput>({
    schema: newPasswordSchema,
    defaultValues: { password: "", confirm: "" },
    submit: (values) => acceptInvite(token, values),
    successMessage: t("done"),
    onSuccess: () => router.push("/login?notice=PasswordSet"),
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <FormField label={t("password")} htmlFor="new-password" hint={t("passwordHint")} error={fieldError("password")} required>
        <Input type="password" autoComplete="new-password" autoFocus {...form.register("password")} />
      </FormField>
      <FormField label={t("confirm")} htmlFor="confirm-password" error={fieldError("confirm")} required>
        <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
      </FormField>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
