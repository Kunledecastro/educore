"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Play, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@educore/ui/button";
import { ConfirmAction } from "@/components/form/confirm-action";
import { toCsv } from "@/lib/imports/csv";
import { cancelImport, startImport } from "../actions";

export function StartImportButton({ jobId, count }: { jobId: string; count: number }) {
  const t = useTranslations("imports.report");
  return (
    <ConfirmAction
      trigger={
        <Button>
          <Play className="h-4 w-4" aria-hidden="true" />
          {t("start", { count })}
        </Button>
      }
      title={t("startTitle", { count })}
      description={t("startDescription")}
      confirmLabel={t("start", { count })}
      destructive={false}
      action={() => startImport(jobId)}
      successMessage={t("started")}
    />
  );
}

export function CancelImportButton({ jobId }: { jobId: string }) {
  const t = useTranslations("imports.report");
  return (
    <ConfirmAction
      trigger={
        <Button variant="outline">
          <X className="h-4 w-4" aria-hidden="true" />
          {t("cancel")}
        </Button>
      }
      title={t("cancelTitle")}
      description={t("cancelDescription")}
      confirmLabel={t("cancel")}
      action={() => cancelImport(jobId)}
      successMessage={t("cancelled")}
    />
  );
}

export function UploadAgainLink({ href = "/imports" }: { href?: string }) {
  const t = useTranslations("imports.report");
  return (
    <Link href={href} className={buttonVariants({ variant: "ghost" })}>
      <Upload className="h-4 w-4" aria-hidden="true" />
      {t("uploadAnother")}
    </Link>
  );
}

/** Re-renders the server page every 2 s while the import runs, so progress updates live. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}

/** Downloads the (already translated) problem list as a CSV to fix in Excel. */
export function DownloadIssuesButton({ fileName, rows }: { fileName: string; rows: [string, string, string][] }) {
  const t = useTranslations("imports.report");
  const download = () => {
    const blob = new Blob([toCsv([t("row"), t("column"), t("problem")], rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.[^.]+$/, "")}-problems.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="outline" size="sm" onClick={download}>
      <Download className="h-4 w-4" aria-hidden="true" />
      {t("downloadIssues")}
    </Button>
  );
}
