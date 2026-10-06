"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { resetPasswordAction } from "../forgot-password/actions";

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("passwordReset");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [done, setDone] = React.useState(false);
  const [pending, start] = React.useTransition();
  if (done) {
    return (
      <div className="space-y-3 text-center" role="status">
        <p className="text-sm">{t("doneBody")}</p>
        <Link href="/login" className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          {t("signIn")}
        </Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await resetPasswordAction({ token, password, confirm });
          if (r.ok) setDone(true);
          else {
            setErrors(r.fieldErrors ?? {});
            toast.error(r.error);
          }
        });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="rp-new" className="text-sm font-medium">
          {t("newPassword")}
        </label>
        <Input id="rp-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={errors.password ? true : undefined} aria-describedby="rp-hint" />
        <p id="rp-hint" className={`text-xs ${errors.password ? "text-destructive" : "text-muted-foreground"}`}>
          {errors.password ?? t("rules")}
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="rp-confirm" className="text-sm font-medium">
          {t("confirm")}
        </label>
        <Input id="rp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={errors.confirm ? true : undefined} />
        {errors.confirm ? <p className="text-xs text-destructive">{errors.confirm}</p> : null}
      </div>
      <Button type="submit" className="w-full" disabled={pending || !password || !confirm}>
        {pending ? t("saving") : t("save")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("signedOutNote")}</p>
    </form>
  );
}
