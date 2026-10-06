"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Printer } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { confirmSetupAction, startSetupAction } from "../actions";

/** Three steps: get an app → scan and confirm → save backup codes. */
export function SetupWizard({ required, email }: { required: boolean; email: string }) {
  const t = useTranslations("twoFactor.setup");
  const router = useRouter();
  const [key, setKey] = React.useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, start] = React.useTransition();

  const begin = () =>
    start(async () => {
      const r = await startSetupAction();
      if (r.ok) setKey(r.data);
      else toast.error(r.error);
    });
  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await confirmSetupAction({ code });
      if (r.ok) setCodes(r.data.backupCodes);
      else {
        toast.error(r.error);
        setCode("");
      }
    });
  };

  if (codes) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-success p-4 text-sm" role="status">
          <p className="font-medium">{t("doneTitle")}</p>
          <p className="text-muted-foreground">{t("codesIntro")}</p>
        </div>
        <ol className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-4 font-mono text-sm print:border-black" aria-label={t("codesLabel")}>
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">{t("codesFor", { email })}</p>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(codes.join("\n"));
                toast.success(t("copied"));
              } catch {
                toast.error(t("copyFailed"));
              }
            }}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            {t("copy")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {t("print")}
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm print:hidden">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          {t("savedConfirm")}
        </label>
        <Button
          type="button"
          className="w-full print:hidden"
          disabled={!saved}
          onClick={() => {
            router.push("/dashboard");
            router.refresh();
          }}
        >
          {t("continue")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="space-y-5">
        <li className="space-y-1">
          <p className="font-medium">{t("step1Title")}</p>
          <p className="text-sm text-muted-foreground">{t("step1")}</p>
        </li>
        <li className="space-y-3">
          <p className="font-medium">{t("step2Title")}</p>
          {!key ? (
            <Button type="button" onClick={begin} disabled={pending}>
              {t("showCode")}
            </Button>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t("step2")}</p>
              {/* Generated on our server from the key; contains no scripts (SVG paths only). */}
              <div className="mx-auto w-48 rounded-md bg-white p-2" role="img" aria-label={t("qrLabel")} dangerouslySetInnerHTML={{ __html: key.qrSvg }} />
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{t("cantScan")}</summary>
                <p className="mt-2 break-all rounded-md bg-muted p-2 font-mono tracking-wider">{key.secret.match(/.{1,4}/g)?.join(" ")}</p>
              </details>
            </>
          )}
        </li>
        {key ? (
          <li className="space-y-2">
            <p className="font-medium">{t("step3Title")}</p>
            <form onSubmit={confirm} className="flex gap-2" noValidate>
              <label htmlFor="setup-code" className="sr-only">
                {t("codeLabel")}
              </label>
              <Input
                id="setup-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                placeholder="123456"
                className="font-mono tracking-widest"
              />
              <Button type="submit" disabled={pending || code.replace(/\s/g, "").length !== 6}>
                {t("confirm")}
              </Button>
            </form>
          </li>
        ) : null}
      </ol>
      <div className="flex justify-between text-sm">
        {required ? (
          <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => signOut({ callbackUrl: "/login" })}>
            {t("signOut")}
          </button>
        ) : (
          <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => router.push("/account/security")}>
            {t("cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
