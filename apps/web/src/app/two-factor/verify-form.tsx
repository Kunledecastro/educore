"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { verifyCodeAction } from "./actions";

export function VerifyForm() {
  const t = useTranslations("twoFactor.verify");
  const router = useRouter();
  const [backup, setBackup] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [pending, start] = React.useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    start(async () => {
      const r = await verifyCodeAction({ code, remember });
      if (!r.ok) {
        toast.error(r.error);
        setCode("");
        return;
      }
      if (r.data.method === "backup") toast.warning(t("backupUsed", { left: r.data.backupLeft }));
      router.push("/dashboard");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="tf-code" className="text-sm font-medium">
          {backup ? t("backupLabel") : t("codeLabel")}
        </label>
        <Input
          id="tf-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          autoComplete={backup ? "off" : "one-time-code"}
          inputMode={backup ? "text" : "numeric"}
          pattern={backup ? undefined : "[0-9 ]*"}
          maxLength={backup ? 20 : 7}
          placeholder={backup ? "xxxx-xxxx-xxxx" : "123456"}
          className="text-center font-mono text-lg tracking-widest"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        {t("remember")}
      </label>
      <Button type="submit" className="w-full" disabled={pending || !code.trim()}>
        {pending ? t("checking") : t("submit")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="underline underline-offset-2" onClick={() => { setBackup((b) => !b); setCode(""); }}>
          {backup ? t("useApp") : t("useBackup")}
        </button>
        <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => signOut({ callbackUrl: "/login" })}>
          {t("signOut")}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t("lostPhone")}</p>
    </form>
  );
}
