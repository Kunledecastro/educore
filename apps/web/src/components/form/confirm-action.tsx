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
 * element you pass, or control it with `open`/`onOpenChange` — do that for
 * menu items: a dialog rendered inside a dropdown unmounts when the menu closes.
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = true,
  action,
  successMessage,
  open: controlledOpen,
  onOpenChange,
}: {
  /** Omit when opening it yourself via `open`/`onOpenChange` (e.g. from a dropdown menu item). */
  trigger?: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  action: () => Promise<ActionResult<unknown>>;
  successMessage: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("common");
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [pending, startTransition] = React.useTransition();

  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
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
