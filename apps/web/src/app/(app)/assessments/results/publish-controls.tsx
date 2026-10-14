"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Stamp } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@educore/ui/dialog";
import { Label } from "@educore/ui/label";
import { Textarea } from "@educore/ui/textarea";
import { ConfirmAction } from "@/components/form/confirm-action";
import { publishResults, unpublishResults } from "./actions";

/**
 * Publish / unpublish a class's results. When the school requires approval
 * (Phase 8.1) the buttons say so: publishing sends a request; unpublishing
 * asks why and which subjects will change, then sends a request.
 */
export function PublishControls({
  classId,
  termId,
  label,
  published,
  missingScores,
  disabled,
  approval,
  subjects,
  pending,
}: {
  classId: string;
  termId: string;
  label: string;
  published: boolean;
  missingScores: number;
  disabled: boolean;
  approval: { publish: boolean; unpublish: boolean };
  subjects: { id: string; name: string }[];
  /** A request for this class and term is already waiting. */
  pending: boolean;
}) {
  const t = useTranslations("gradebook.publish");
  const router = useRouter();
  if (published) {
    return approval.unpublish ? (
      <UnpublishRequest classId={classId} termId={termId} label={label} subjects={subjects} disabled={pending} />
    ) : (
      <ConfirmAction
        trigger={
          <Button variant="outline">
            <EyeOff className="h-4 w-4" aria-hidden="true" />
            {t("unpublish")}
          </Button>
        }
        title={t("unpublishTitle", { label })}
        description={t("unpublishDescription")}
        confirmLabel={t("unpublish")}
        action={() => unpublishResults({ classId, termId })}
        successMessage={t("unpublished", { label })}
        onSuccess={() => router.refresh()}
      />
    );
  }
  return (
    <ConfirmAction
      trigger={
        <Button disabled={disabled || pending}>
          {approval.publish ? <Stamp className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          {approval.publish ? t("requestPublish") : t("publish")}
        </Button>
      }
      title={t("publishTitle", { label })}
      description={
        <>
          {approval.publish ? t("publishNeedsApproval") : t("publishDescription")}
          {missingScores > 0 ? <span className="mt-2 block font-medium text-destructive">{t("publishMissing", { count: missingScores })}</span> : null}
        </>
      }
      confirmLabel={approval.publish ? t("sendRequest") : t("publish")}
      destructive={false}
      action={() => publishResults({ classId, termId })}
      successMessage={t("publishedDone", { label })}
      onSuccess={() => router.refresh()}
    />
  );
}

function UnpublishRequest({ classId, termId, label, subjects, disabled }: { classId: string; termId: string; label: string; subjects: { id: string; name: string }[]; disabled: boolean }) {
  const t = useTranslations("gradebook.publish");
  const tRoot = useTranslations();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, start] = React.useTransition();
  const id = React.useId();
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Stamp className="h-4 w-4" aria-hidden="true" />
          {t("requestUnpublish")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await unpublishResults({ classId, termId, reason, subjectIds: picked });
              if (r.ok) {
                toast.success(tRoot("approvals.sentForApproval"));
                setOpen(false);
                setReason("");
                setPicked([]);
                setErrors({});
                router.refresh();
              } else {
                setErrors(r.fieldErrors ?? {});
                toast.error(r.error);
              }
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("unpublishTitle", { label })}</DialogTitle>
            <DialogDescription>{t("unpublishNeedsApproval")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-reason`}>{t("reasonLabel")}</Label>
            <Textarea id={`${id}-reason`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? `${id}-reason-err` : undefined} placeholder={t("reasonPlaceholder")} />
            {errors.reason ? (
              <p id={`${id}-reason-err`} className="text-sm text-destructive">
                {errors.reason}
              </p>
            ) : null}
          </div>
          <fieldset className="space-y-2" aria-describedby={errors.subjectIds ? `${id}-subj-err` : undefined}>
            <legend className="text-sm font-medium">{t("subjectsLabel")}</legend>
            <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
              {subjects.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={picked.includes(s.id)} onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))} />
                  {s.name}
                </label>
              ))}
            </div>
            {errors.subjectIds ? (
              <p id={`${id}-subj-err`} className="text-sm text-destructive">
                {errors.subjectIds}
              </p>
            ) : null}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {tRoot("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? tRoot("common.working") : t("sendRequest")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
