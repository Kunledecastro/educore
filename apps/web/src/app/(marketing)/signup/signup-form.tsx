"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { suggestSlug } from "@/lib/slugs";
import { signupSchema, type SignupInput } from "@/lib/validation/signup";
import { checkSlugAction, signupAction, type SlugStatus } from "./actions";

export function SignupForm({ rootDomain }: { rootDomain: string }) {
  const t = useTranslations("signup");
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const slugEdited = React.useRef(false);
  const [slugStatus, setSlugStatus] = React.useState<SlugStatus | "checking" | null>(null);

  const { form, onSubmit, pending, fieldError } = useServerForm<SignupInput>({
    schema: signupSchema,
    defaultValues: { schoolName: "", slug: "", adminName: "", email: "", password: "", confirm: "", accept: false as unknown as true, website: "" },
    submit: async (values) => {
      const result = await signupAction(values);
      if (result.ok) {
        setCreating(true);
        const signedIn = await signIn("credentials", { email: values.email, password: values.password, redirect: false });
        if (signedIn?.error) router.push("/login");
        else {
          router.push("/dashboard");
          router.refresh();
        }
      }
      return result;
    },
    successMessage: t("created"),
  });

  const schoolName = form.watch("schoolName");
  const slug = form.watch("slug");

  // Suggest a short name from the school's name until the person edits it themselves.
  React.useEffect(() => {
    if (!slugEdited.current) form.setValue("slug", suggestSlug(schoolName ?? ""), { shouldValidate: false });
  }, [schoolName, form]);

  // Live availability, a moment after typing stops.
  React.useEffect(() => {
    const s = (slug ?? "").trim().toLowerCase();
    if (!s) {
      setSlugStatus(null);
      return;
    }
    setSlugStatus("checking");
    const timer = setTimeout(async () => setSlugStatus(await checkSlugAction(s)), 450);
    return () => clearTimeout(timer);
  }, [slug]);

  const busy = pending || creating;
  const slugHint =
    slugStatus && slugStatus !== "checking" ? t(`slugStatus.${slugStatus}`, { address: `${slug}.${rootDomain}` }) : t("slugHint", { address: `${slug || "your-school"}.${rootDomain}` });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={t("schoolName")} htmlFor="su-school" error={fieldError("schoolName")} required>
        <Input id="su-school" autoComplete="organization" maxLength={100} autoFocus {...form.register("schoolName")} />
      </FormField>
      <FormField label={t("slug")} htmlFor="su-slug" error={fieldError("slug")} hint={slugHint} required>
        <Input
          id="su-slug"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
          aria-invalid={slugStatus === "taken" || slugStatus === "reserved" || slugStatus === "format" ? true : undefined}
          {...form.register("slug", { onChange: () => (slugEdited.current = true) })}
        />
      </FormField>
      <FormField label={t("adminName")} htmlFor="su-name" error={fieldError("adminName")} required>
        <Input id="su-name" autoComplete="name" maxLength={80} {...form.register("adminName")} />
      </FormField>
      <FormField label={t("email")} htmlFor="su-email" error={fieldError("email")} hint={t("emailHint")} required>
        <Input id="su-email" type="email" autoComplete="email" {...form.register("email")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("password")} htmlFor="su-password" error={fieldError("password")} hint={t("passwordHint")} required>
          <Input id="su-password" type="password" autoComplete="new-password" {...form.register("password")} />
        </FormField>
        <FormField label={t("confirm")} htmlFor="su-confirm" error={fieldError("confirm")} required>
          <Input id="su-confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
        </FormField>
      </div>
      {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden="true" className="absolute left-[-10000px] h-px w-px overflow-hidden">
        <label htmlFor="su-website">Website</label>
        <input id="su-website" tabIndex={-1} autoComplete="off" {...form.register("website")} />
      </div>
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" {...form.register("accept")} />
          <span>
            {t.rich("accept", { terms: (chunks) => <Link href="/terms" target="_blank" className="underline underline-offset-2">{chunks}</Link> })}
          </span>
        </label>
        {fieldError("accept") ? <p className="text-sm text-destructive">{fieldError("accept")}</p> : null}
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {creating ? t("signingIn") : pending ? t("creating") : t("submit")}
      </Button>
    </form>
  );
}
