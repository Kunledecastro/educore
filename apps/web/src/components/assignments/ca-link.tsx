"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@educore/ui/dialog";
import { Select } from "@educore/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { caPreviewAction, caSendAction, linkComponentAction } from "@/app/(app)/assignments/actions";
import type { CaPreview } from "@/lib/assignments/ca-data";

/**
 * "Counts towards" a score component, and "Send to gradebook" with a
 * pupil-by-pupil preview the teacher confirms (Phase 5.3).
 */
export function CaLink({ assignmentId, components, linkedId, linkedName, termName, scored, sentAt, canSend }: {
  assignmentId: string;
  components: { id: string; name: string }[];
  linkedId: string | null;
  linkedName: string | null;
  termName: string | null;
  scored: boolean;
  sentAt: string | null;
  canSend: boolean;
}) {
  const t = useTranslations("assignments.ca");
  const router = useRouter();
  const [choice, setChoice] = React.useState(linkedId ?? "");
  const [pending, start] = React.useTransition();
  const [preview, setPreview] = React.useState<CaPreview | null>(null);

  if (!scored) return <p className="text-sm text-muted-foreground">{t("needsScore")}</p>;
  if (components.length === 0) return <p className="text-sm text-muted-foreground">{t("noComponents")}</p>;

  const save = () =>
    start(async () => {
      const r = await linkComponentAction(assignmentId, choice);
      if (r.ok) {
        toast.success(t("linkSaved"));
        router.refresh();
      } else toast.error(r.error);
    });
  const openPreview = () =>
    start(async () => {
      const r = await caPreviewAction(assignmentId);
      if (r.ok) setPreview(r.data);
      else toast.error(r.error);
    });
  const send = () =>
    start(async () => {
      const r = await caSendAction(assignmentId);
      if (r.ok) {
        toast.success(t("sent", { created: r.data.created, updated: r.data.updated, component: r.data.component }));
        setPreview(null);
        router.refresh();
      } else toast.error(r.error);
    });

  const changes = preview ? preview.rows.filter((r) => r.proposed !== null && r.proposed !== r.current).length : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <label htmlFor={`ca-${assignmentId}`} className="text-sm font-medium">
            {t("countsTowards")}
          </label>
          <Select id={`ca-${assignmentId}`} value={choice} onChange={(e) => setChoice(e.target.value)} className="min-w-48">
            <option value="">{t("none")}</option>
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={pending || choice === (linkedId ?? "")} onClick={save}>
          {t("saveLink")}
        </Button>
      </div>
      {linkedId ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {termName ? t("explain", { component: linkedName ?? "", term: termName }) : t("noTerm")}
            {sentAt ? ` ${t("lastSent", { when: sentAt })}` : ""}
          </p>
          {canSend && termName ? (
            <Button type="button" size="sm" disabled={pending} onClick={openPreview}>
              <BookCheck className="h-4 w-4" aria-hidden="true" />
              {t("send", { component: linkedName ?? "" })}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={preview !== null} onOpenChange={(o) => !o && !pending && setPreview(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {preview ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("previewTitle", { component: preview.component.name, term: preview.term.name })}</DialogTitle>
                <DialogDescription>{t("previewDescription", { count: preview.assignments.length, max: preview.columnMax })}</DialogDescription>
              </DialogHeader>
              <ul className="space-y-1 text-sm">
                {preview.assignments.map((a) => (
                  <li key={a.id}>
                    {t("assignmentLine", { title: a.title, max: a.maxScore, marked: a.marked })}
                    {a.waiting > 0 ? <span className="text-warning"> · {t("waiting", { count: a.waiting })}</span> : null}
                  </li>
                ))}
              </ul>
              {preview.published ? <p className="rounded-md border border-destructive p-3 text-sm text-destructive">{t("published")}</p> : null}
              {!preview.yearActive ? <p className="rounded-md border border-destructive p-3 text-sm text-destructive">{t("yearInactive")}</p> : null}
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pupil")}</TableHead>
                      <TableHead className="text-right">{t("current")}</TableHead>
                      <TableHead className="text-right">{t("new")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r) => {
                      const changed = r.proposed !== null && r.proposed !== r.current;
                      return (
                        <TableRow key={r.student.id}>
                          <TableCell>{r.student.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.current ?? "—"}</TableCell>
                          <TableCell className={`text-right tabular-nums ${changed ? "font-semibold" : "text-muted-foreground"}`}>
                            {r.proposed === null ? t("unchanged") : r.proposed}
                            {r.proposed !== null ? <span className="sr-only"> {t("fromCount", { count: r.from })}</span> : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">{t("rule")}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" disabled={pending} onClick={() => setPreview(null)}>
                  {t("cancel")}
                </Button>
                <Button type="button" disabled={pending || preview.published || !preview.yearActive || changes === 0} onClick={send}>
                  {changes === 0 ? t("nothingToChange") : t("confirm", { count: changes })}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
