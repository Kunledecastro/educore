"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { FormField } from "@/components/form/form-field";

export function LoginForm() {
  const t = useTranslations("login");
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  const schema = React.useMemo(
    () =>
      z.object({
        email: z.string().trim().email(t("emailInvalid")),
        password: z.string().min(1, t("passwordRequired")),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const result = await signIn("credentials", { ...values, redirect: false });
      if (result?.error) {
        toast.error(result.code === "rate_limited" ? t("rateLimited") : t("error"));
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField label={t("email")} htmlFor="email" error={errors.email?.message} required>
        <Input type="email" autoComplete="email" {...register("email")} />
      </FormField>
      <FormField label={t("password")} htmlFor="password" error={errors.password?.message} required>
        <Input type="password" autoComplete="current-password" {...register("password")} />
      </FormField>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
