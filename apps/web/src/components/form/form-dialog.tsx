"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@educore/ui/dialog";

/**
 * Dialog shell for a create/edit form. The body is a render function that
 * receives `close`, so the form can close the dialog after a successful save.
 * Forms are unmounted when closed, so reopening starts fresh.
 */
export function FormDialog({
  trigger,
  title,
  description,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  children: (close: () => void) => React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("common");
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {open ? children(() => setOpen(false)) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Standard Cancel / Save row for forms inside a FormDialog. */
export function FormDialogFooter({ pending, onCancel, submitLabel }: { pending: boolean; onCancel: () => void; submitLabel?: string }) {
  const t = useTranslations("common");
  return (
    <DialogFooter className="pt-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
        {t("cancel")}
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : (submitLabel ?? t("save"))}
      </Button>
    </DialogFooter>
  );
}
