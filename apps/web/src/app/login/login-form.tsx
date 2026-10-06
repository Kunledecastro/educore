"use client";

import * as React from "react";
import Link from "next/link";
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

type Mode = "email" | "student";

/**
 * Sign-in. Staff and parents use their email; students (Phase 5.0) use their
 * school's short name + admission number. On a school's own address the
 * short name is filled in.
 */
export function LoginForm({ schoolSlug = null, initialMode = "email" }: { schoolSlug?: string | null; initialMode?: Mode }) {
  const t = useTranslations("login");
  const [mode, setMode] = React.useState<Mode>(initialMode);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t("whoLabel")} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
        {(["email", "student"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            aria-controls={`login-${m}`}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            {t(m === "email" ? "tabStaff" : "tabStudent")}
          </button>
        ))}
      </div>
      <div id={`login-${mode}`} role="tabpanel">
        {mode === "email" ? <EmailForm /> : <StudentForm schoolSlug={schoolSlug} />}
      </div>
    </div>
  );
}

function useSignIn() {
  const t = useTranslations("login");
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  async function go(credentials: Record<string, string>) {
    setSubmitting(true);
    try {
      const result = await signIn("credentials", { ...credentials, redirect: false });
      if (result?.error) {
        toast.error(result.code === "rate_limited" ? t("rateLimited") : credentials.admissionNo ? t("studentError") : t("error"));
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }
  return { go, submitting };
}

function EmailForm() {
  const t = useTranslations("login");
  const { go, submitting } = useSignIn();
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

  return (
    <form onSubmit={handleSubmit((v) => go(v))} className="space-y-4" noValidate>
      <FormField label={t("email")} htmlFor="email" error={errors.email?.message} required>
        <Input type="email" autoComplete="email" {...register("email")} />
      </FormField>
      <FormField label={t("password")} htmlFor="password" error={errors.password?.message} required>
        <Input type="password" autoComplete="current-password" {...register("password")} />
      </FormField>
      <p className="-mt-2 text-right text-sm">
        <Link href="/forgot-password" className="underline underline-offset-2">
          {t("forgot")}
        </Link>
      </p>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

function StudentForm({ schoolSlug }: { schoolSlug: string | null }) {
  const t = useTranslations("login");
  const { go, submitting } = useSignIn();
  const schema = React.useMemo(
    () =>
      z.object({
        school: z.string().trim().min(3, t("schoolRequired")).max(30, t("schoolRequired")),
        admissionNo: z.string().trim().min(1, t("admissionRequired")).max(40, t("admissionRequired")),
        password: z.string().min(1, t("passwordRequired")),
      }),
    [t],
  );
  type FormValues = z.infer<typeof schema>;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { school: schoolSlug ?? "", admissionNo: "", password: "" } });

  return (
    <form onSubmit={handleSubmit((v) => go(v))} className="space-y-4" noValidate>
      {schoolSlug ? (
        <input type="hidden" {...register("school")} />
      ) : (
        <FormField label={t("school")} htmlFor="school" error={errors.school?.message} hint={t("schoolHint")} required>
          <Input id="school" autoCapitalize="none" spellCheck={false} autoComplete="organization" {...register("school")} />
        </FormField>
      )}
      <FormField label={t("admissionNo")} htmlFor="admissionNo" error={errors.admissionNo?.message} required>
        <Input id="admissionNo" autoCapitalize="characters" spellCheck={false} autoComplete="username" {...register("admissionNo")} />
      </FormField>
      <FormField label={t("password")} htmlFor="student-password" error={errors.password?.message} hint={t("studentPasswordHint")} required>
        <Input id="student-password" type="password" autoComplete="current-password" {...register("password")} />
      </FormField>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
