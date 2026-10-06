"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@educore/ui/dialog";
import { Input } from "@educore/ui/input";
import { disableAction, regenerateCodesAction } from "@/app/two-factor/actions";

type Mode = "regen" | "disable" | null;

export function SecurityControls({ enabled, required, lowBackup }: { enabled: boolean; required: boolean; lowBackup: boolean }) {
  const t = useTranslations("twoFactor.account");
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>(null);
  const [code, setCode] = React.useState("");
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [pending, start] = React.useTransition();

  if (!enabled) {
    return (
      <Link href="/two-factor/setup" className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
        {t("turnOn")}
      </Link>
    );
  }

  const close = () => {
    if (pending) return;
    setMode(null);
    setCode("");
    setCodes(null);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      if (mode === "regen") {
        const r = await regenerateCodesAction({ code });
        if (r.ok) setCodes(r.data.backupCodes);
        else toast.error(r.error);
      } else if (mode === "disable") {
        const r = await disableAction({ code });
        if (r.ok) {
          toast.success(t("turnedOff"));
          close();
          router.refresh();
        } else toast.error(r.error);
      }
      setCode("");
    });
  };

  return (
    <div className="space-y-2">
      {lowBackup ? <p className="text-sm text-warning">{t("lowBackup")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setMode("regen")}>
          {t("newCodes")}
        </Button>
        {!required ? (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => setMode("disable")}>
            {t("turnOff")}
          </Button>
        ) : null}
      </div>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{mode === "regen" ? t("newCodesTitle") : t("turnOffTitle")}</DialogTitle>
            <DialogDescription>{codes ? t("codesShownOnce") : mode === "regen" ? t("newCodesDescription") : t("turnOffDescription")}</DialogDescription>
          </DialogHeader>
          {codes ? (
            <div className="space-y-3">
              <ol className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
              <div className="flex gap-2">
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
                  {t("copy")}
                </Button>
                <Button type="button" size="sm" onClick={() => { close(); router.refresh(); }}>
                  {t("done")}
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3" noValidate>
              <label htmlFor="sec-code" className="text-sm font-medium">
                {t("codeLabel")}
              </label>
              <Input id="sec-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={20} className="font-mono tracking-widest" autoFocus />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={close} disabled={pending}>
                  {t("cancel")}
                </Button>
                <Button type="submit" variant={mode === "disable" ? "destructive" : "default"} disabled={pending || !code.trim()}>
                  {mode === "regen" ? t("newCodes") : t("turnOff")}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
