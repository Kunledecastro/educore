"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { recheckOnlinePaymentAction } from "../fees/online-actions";

export function RecheckButton({ id }: { id: string }) {
  const t = useTranslations("payments.online");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await recheckOnlinePaymentAction(id);
          if (result.ok) {
            toast.success(t(`recheck.${(result.data as { result: string }).result}` as never));
            router.refresh();
          } else toast.error(result.error);
        })
      }
    >
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      {pending ? t("checking") : t("checkAgain")}
    </Button>
  );
}
