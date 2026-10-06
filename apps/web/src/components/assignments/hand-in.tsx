"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, FileText, Paperclip, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@educore/ui/badge";
import { Button } from "@educore/ui/button";
import { Textarea } from "@educore/ui/textarea";
import { handInAction, requestSubmissionUploadAction } from "@/app/(app)/assignments/actions";
import { shrinkPhoto } from "@/lib/image-shrink";
import { MAX_FILE_BYTES, MAX_FILES_PER_SUBMISSION } from "@/lib/storage/file-types";
import { ACCEPT, declaredType, formatBytes, putToStorage } from "./file-upload";

export interface HandInView {
  student: { id: string; name: string };
  mayHandIn: boolean;
  submission: null | {
    status: "SUBMITTED" | "RETURNED" | "MARKED";
    text: string;
    isLate: boolean;
    isMissing: boolean;
    submittedAt: string;
    score: number | null;
    feedback: string | null;
    files: { id: string; fileName: string; sizeBytes: number }[];
  };
}

const STATUS_VARIANT = { SUBMITTED: "secondary", RETURNED: "warning", MARKED: "success" } as const;

/**
 * A pupil's (or parent's) own work on one assignment: what's been handed in,
 * the teacher's comment and score once shared, and the form to hand in or
 * hand in again. Photos are shrunk on the device before upload.
 */
export function HandIn({ assignmentId, view, maxScore, showName, storageReady, formatted }: {
  assignmentId: string;
  view: HandInView;
  maxScore: number | null;
  showName: boolean;
  storageReady: boolean;
  /** Pre-formatted dates/numbers from the server (school's time zone and locale). */
  formatted: { submittedAt: string | null; score: string | null; maxScore: string | null };
}) {
  const t = useTranslations("assignments.handIn");
  const router = useRouter();
  const sub = view.submission;
  const [editing, setEditing] = React.useState(view.mayHandIn && (!sub || sub.status === "RETURNED"));
  const [text, setText] = React.useState(sub?.text ?? "");
  const [newFiles, setNewFiles] = React.useState<File[]>([]);
  const [removeIds, setRemoveIds] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const camera = React.useRef<HTMLInputElement>(null);
  const keptCount = (sub?.files.length ?? 0) - removeIds.size;

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const added: File[] = [];
    for (const raw of Array.from(list)) {
      if (keptCount + newFiles.length + added.length >= MAX_FILES_PER_SUBMISSION) {
        toast.error(t("tooMany", { max: MAX_FILES_PER_SUBMISSION }));
        break;
      }
      if (!declaredType(raw)) {
        toast.error(t("badType", { name: raw.name }));
        continue;
      }
      setBusy(t("preparing"));
      const file = await shrinkPhoto(raw);
      if (file.size === 0 || file.size > MAX_FILE_BYTES) {
        toast.error(t("tooLarge", { name: raw.name }));
        continue;
      }
      added.push(file);
    }
    setBusy(null);
    setNewFiles((f) => [...f, ...added]);
    if (input.current) input.current.value = "";
    if (camera.current) camera.current.value = "";
  }

  async function submit() {
    if (!text.trim() && keptCount + newFiles.length === 0) return toast.error(t("empty"));
    const grants: string[] = [];
    try {
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i]!;
        const type = declaredType(file)!;
        setBusy(t("uploading", { n: i + 1, total: newFiles.length }));
        const slot = await requestSubmissionUploadAction({ assignmentId, fileName: file.name, contentType: type, sizeBytes: file.size });
        if (!slot.ok) return toast.error(slot.error);
        if (!(await putToStorage(slot.data.uploadUrl, file, type))) return toast.error(t("uploadFailed", { name: file.name }));
        grants.push(slot.data.grant);
      }
      setBusy(t("sending"));
      const r = await handInAction({ assignmentId, studentId: view.student.id, text, grants, removeFileIds: [...removeIds] });
      if (!r.ok) return toast.error(r.error);
      toast.success(t("done"));
      setNewFiles([]);
      setRemoveIds(new Set());
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5" aria-labelledby={`hi-${view.student.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`hi-${view.student.id}`} className="text-lg font-semibold">
          {showName ? t("titleFor", { name: view.student.name }) : t("title")}
        </h2>
        {sub ? (
          <div className="flex items-center gap-2">
            {sub.isLate && !sub.isMissing ? <Badge variant="warning">{t("late")}</Badge> : null}
            <Badge variant={sub.isMissing ? "destructive" : STATUS_VARIANT[sub.status]}>{sub.isMissing ? t("notHandedIn") : t(`status.${sub.status}`)}</Badge>
          </div>
        ) : (
          <Badge variant="outline">{t("notYet")}</Badge>
        )}
      </div>

      {sub && formatted.submittedAt && !sub.isMissing ? <p className="text-sm text-muted-foreground">{t("handedInAt", { when: formatted.submittedAt })}</p> : null}

      {sub && (sub.feedback || formatted.score) ? (
        <div className={`rounded-md border p-4 ${sub.status === "RETURNED" ? "border-warning" : "border-success"}`} role="status">
          {formatted.score && formatted.maxScore ? <p className="text-lg font-semibold tabular-nums">{t("score", { score: formatted.score, max: formatted.maxScore })}</p> : null}
          {sub.feedback ? (
            <>
              <p className="text-sm font-medium">{t("teacherSays")}</p>
              <p className="whitespace-pre-line text-sm">{sub.feedback}</p>
            </>
          ) : null}
        </div>
      ) : sub?.status === "MARKED" && maxScore !== null ? (
        <p className="text-sm text-muted-foreground">{t("markedNotShared")}</p>
      ) : null}

      {!editing ? (
        <>
          {sub && sub.text ? <p className="whitespace-pre-line rounded-md bg-muted p-3 text-sm">{sub.text}</p> : null}
          {sub && sub.files.length ? (
            <ul className="space-y-1 text-sm">
              {sub.files.map((f) => (
                <li key={f.id}>
                  <a className="inline-flex items-center gap-2 underline-offset-2 hover:underline" href={`/api/assignments/files/${f.id}`}>
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    {f.fileName} <span className="text-xs text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {view.mayHandIn ? (
            <Button type="button" variant="outline" onClick={() => setEditing(true)}>
              {sub ? t("handInAgain") : t("start")}
            </Button>
          ) : !sub ? (
            <p className="text-sm text-muted-foreground">{t("cannot")}</p>
          ) : null}
        </>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`hi-text-${view.student.id}`} className="text-sm font-medium">
              {t("answer")}
            </label>
            <Textarea id={`hi-text-${view.student.id}`} rows={6} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("answerPlaceholder")} />
          </div>

          {sub && sub.files.length ? (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t("yourFiles")}</legend>
              {sub.files.map((f) => (
                <label key={f.id} className={`flex items-center gap-2 text-sm ${removeIds.has(f.id) ? "text-muted-foreground line-through" : ""}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={!removeIds.has(f.id)}
                    onChange={() =>
                      setRemoveIds((s) => {
                        const n = new Set(s);
                        if (n.has(f.id)) n.delete(f.id);
                        else n.add(f.id);
                        return n;
                      })
                    }
                  />
                  {f.fileName}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">{t("untickToRemove")}</p>
            </fieldset>
          ) : null}

          {newFiles.length ? (
            <ul className="space-y-1 text-sm" aria-label={t("toUpload")}>
              {newFiles.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                  <Button type="button" variant="ghost" size="sm" aria-label={t("removeNew", { name: f.name })} onClick={() => setNewFiles((all) => all.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {storageReady ? (
            <div className="flex flex-wrap gap-2">
              <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" id={`hi-files-${view.student.id}`} onChange={(e) => void addFiles(e.target.files)} />
              <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" id={`hi-cam-${view.student.id}`} onChange={(e) => void addFiles(e.target.files)} />
              <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => input.current?.click()}>
                <Paperclip className="h-4 w-4" aria-hidden="true" />
                {t("addFiles")}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => camera.current?.click()}>
                <Camera className="h-4 w-4" aria-hidden="true" />
                {t("takePhoto")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("textOnly")}</p>
          )}
          <p className="text-xs text-muted-foreground">{t("allowed", { max: MAX_FILES_PER_SUBMISSION })}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void submit()} disabled={busy !== null}>
              <Send className="h-4 w-4" aria-hidden="true" />
              {busy ?? (sub ? t("submitAgain") : t("submit"))}
            </Button>
            {sub ? (
              <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => setEditing(false)}>
                {t("cancel")}
              </Button>
            ) : null}
            <span aria-live="polite" className="sr-only">
              {busy ?? ""}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
