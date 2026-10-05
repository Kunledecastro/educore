"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { ConfirmAction } from "@/components/form/confirm-action";
import { attachWorksheetAction, removeWorksheetAction, requestWorksheetUploadAction } from "@/app/(app)/assignments/actions";
import { ALLOWED_TYPES, MAX_FILE_BYTES, type AllowedType } from "@/lib/storage/file-types";

const BY_EXTENSION: Record<string, AllowedType> = Object.fromEntries(Object.entries(ALLOWED_TYPES).map(([type, ext]) => [ext, type as AllowedType]));
BY_EXTENSION.jpeg = "image/jpeg";

/** The type we'll declare: the browser's word if it's one we accept, else the extension's. Null = not allowed. */
export function declaredType(file: File): AllowedType | null {
  if (file.type && file.type in ALLOWED_TYPES) return file.type as AllowedType;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

export const ACCEPT = [...Object.keys(ALLOWED_TYPES), ...Object.values(ALLOWED_TYPES).map((e) => `.${e}`), ".jpeg"].join(",");

/** PUTs the file straight to storage using the one-time link. */
export async function putToStorage(uploadUrl: string, file: File, type: AllowedType): Promise<boolean> {
  try {
    const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": type, "x-upsert": "false" }, body: file });
    return res.ok;
  } catch {
    return false;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface FileView {
  id: string;
  fileName: string;
  sizeBytes: number;
}

/** A list of attached files with download links (and remove, for whoever manages them). */
export function FileList({ files, assignmentId, canRemove }: { files: FileView[]; assignmentId: string; canRemove: boolean }) {
  const t = useTranslations("assignments.files");
  const router = useRouter();
  if (files.length === 0) return <p className="text-sm text-muted-foreground">{t("none")}</p>;
  return (
    <ul className="divide-y rounded-md border">
      {files.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <a href={`/api/assignments/files/${f.id}`} className="flex min-w-0 items-center gap-2 underline-offset-2 hover:underline" rel="noopener">
            <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{f.fileName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
          </a>
          {canRemove ? (
            <ConfirmAction
              trigger={
                <Button variant="ghost" size="sm" className="text-destructive" aria-label={t("removeNamed", { name: f.fileName })}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              }
              title={t("removeTitle")}
              description={t("removeDescription", { name: f.fileName })}
              confirmLabel={t("remove")}
              action={() => removeWorksheetAction(assignmentId, f.id)}
              successMessage={t("removed")}
              onSuccess={() => router.refresh()}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Teachers: attach a worksheet (PDF, Word, or a photo) to an assignment. */
export function WorksheetUpload({ assignmentId, disabled }: { assignmentId: string; disabled?: boolean }) {
  const t = useTranslations("assignments.files");
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function upload(file: File) {
    const type = declaredType(file);
    if (!type) return toast.error(t("badType"));
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return toast.error(t("tooLarge"));
    setBusy(true);
    try {
      const slot = await requestWorksheetUploadAction({ assignmentId, fileName: file.name, contentType: type, sizeBytes: file.size });
      if (!slot.ok) return toast.error(slot.error);
      if (!(await putToStorage(slot.data.uploadUrl, file, type))) return toast.error(t("uploadFailed"));
      const done = await attachWorksheetAction(assignmentId, slot.data.grant);
      if (!done.ok) return toast.error(done.error);
      toast.success(t("added"));
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        id={`ws-${assignmentId}`}
        disabled={busy || disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => input.current?.click()}>
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {busy ? t("uploading") : t("add")}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">{t("allowed")}</p>
    </div>
  );
}
