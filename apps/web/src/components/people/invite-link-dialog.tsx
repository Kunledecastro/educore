"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@educore/ui/dialog";
import { Input } from "@educore/ui/input";
import { sendInvite } from "@/server/people-actions";

/**
 * Sends an invite. If email is configured the person gets it directly;
 * otherwise we show the one-time link for the admin to pass on.
 */
export function useSendInvite() {
  const t = useTranslations("people.invite");
  const [pending, startTransition] = React.useTransition();
  const [shared, setShared] = React.useState<{ link: string; email: string } | null>(null);

  const send = (userId: string) =>
    startTransition(async () => {
      const result = await sendInvite(userId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.emailed) toast.success(t("sent", { email: result.data.email }));
      else if (result.data.link) setShared({ link: result.data.link, email: result.data.email });
    });

  const dialog = <InviteLinkDialog shared={shared} onClose={() => setShared(null)} />;
  return { send, pending, dialog };
}

function InviteLinkDialog({ shared, onClose }: { shared: { link: string; email: string } | null; onClose: () => void }) {
  const t = useTranslations("people.invite");
  const tc = useTranslations("common");
  const [copied, setCopied] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const copy = async () => {
    if (!shared) return;
    try {
      await navigator.clipboard.writeText(shared.link);
    } catch {
      inputRef.current?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    toast.success(t("copied"));
  };

  return (
    <Dialog open={Boolean(shared)} onOpenChange={(o) => (o ? null : (setCopied(false), onClose()))}>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("linkTitle")}</DialogTitle>
          <DialogDescription>{t("linkDescription", { email: shared?.email ?? "" })}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input ref={inputRef} readOnly value={shared?.link ?? ""} aria-label={t("linkTitle")} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button type="button" onClick={copy}>
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {t("copy")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
