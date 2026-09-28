"use client";

import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@educore/ui/dialog";

/** "View" button → dialog with the before/after snapshots of one audit entry. */
export function AuditDetails({
  title,
  subtitle,
  before,
  after,
}: {
  title: string;
  subtitle: string;
  before: string | null;
  after: string | null;
}) {
  const t = useTranslations("auditLog");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {t("view")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl" closeLabel={t("close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { label: t("before"), value: before },
            { label: t("after"), value: after },
          ].map(({ label, value }) => (
            <section key={label} className="min-w-0">
              <h3 className="mb-2 text-sm font-medium">{label}</h3>
              {value ? (
                <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">{value}</pre>
              ) : (
                <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">{t("none")}</p>
              )}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
