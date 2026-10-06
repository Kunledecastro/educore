"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { requestResetAction } from "./actions";

export function ForgotForm() {
  const t = useTranslations("passwordReset");
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [pending, start] = React.useTransition();
  if (sent) {
    return (
      <div className="rounded-md border border-success p-4 text-sm" role="status">
        <p className="font-medium">{t("sentTitle")}</p>
        <p className="text-muted-foreground">{t("sentBody", { email })}</p>
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
          const r = await requestResetAction({ email });
          if (r.ok) setSent(true);
          else toast.error(r.error);
        });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="fp-email" className="text-sm font-medium">
          {t("email")}
        </label>
        <Input id="fp-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </div>
      <Button type="submit" className="w-full" disabled={pending || !email.includes("@")}>
        {pending ? t("sending") : t("send")}
      </Button>
    </form>
  );
}
