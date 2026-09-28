"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@educore/ui/alert-dialog";
import type { ActionResult } from "@/lib/action-result";

/**
 * Every destructive action goes through this: a confirmation dialog, then
 * the server action, then a toast with the outcome. The trigger is whatever
 * element you pass (a Button, a DropdownMenuItem with onSelect prevented…).
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = true,
  action,
  successMessage,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  action: () => Promise<ActionResult<unknown>>;
  successMessage: string;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            destructive={destructive}
            disabled={pending}
            onClick={(e) => {
              e.preventDefault(); // keep the dialog open until the action finishes
              startTransition(async () => {
                const result = await action();
                if (result.ok) {
                  toast.success(successMessage);
                  setOpen(false);
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            {pending ? t("working") : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
