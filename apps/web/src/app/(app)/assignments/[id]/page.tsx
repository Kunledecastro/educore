import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { AssignmentStatusControls, EditAssignmentButton } from "@/components/assignments/assignment-form";
import { FileList, WorksheetUpload } from "@/components/assignments/file-upload";
import { STATUS_VARIANT } from "@/components/assignments/status";
import { assignmentViewer, getAssignment } from "@/lib/assignments/data";
import type { AnyRole } from "@/lib/assignments/rules";
import { formatDateTime, formatNumber } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { MAX_FILES_PER_ASSIGNMENT } from "@/lib/storage/file-types";
import { objectStore } from "@/lib/storage/object-store";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";
import { utcToZonedLocal } from "@/lib/zoned-time";

/** One assignment: instructions, worksheets, and (for staff) the controls (Phase 5.1). */
export default async function AssignmentPage({ params }: { params: { id: string } }) {
  const { user } = await requirePermission("assignment", "read", { page: true });
  const id = idSchema.safeParse(params.id);
  if (!id.success) notFound();
  const tenantId = user.tenantId!;
  const viewer = await assignmentViewer(tenantId, { id: user.id, role: user.role as AnyRole });
  const [a, settings, t] = await Promise.all([getAssignment(viewer, id.data), getSettingsForUser(tenantId), getTranslations("assignments")]);
  if (!a) notFound();
  const storageReady = objectStore.configured();
  const isStaff = viewer.role === "SCHOOL_ADMIN" || viewer.role === "TEACHER";

  return (
    <div className="space-y-6">
      <Link href="/assignments" className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <p className="text-sm text-muted-foreground">
            {a.subject.name} · {a.section.class.name} {a.section.name}
            {a.createdBy?.name ? ` · ${t("setBy", { name: a.createdBy.name })}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {isStaff ? <Badge variant={STATUS_VARIANT[a.status]}>{t(`statuses.${a.status}`)}</Badge> : a.status === "CLOSED" ? <Badge variant="outline">{t("statuses.CLOSED")}</Badge> : null}
            <Badge variant="outline">{t(`modes.${a.mode}`)}</Badge>
          </div>
        </div>
        {a.canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <EditAssignmentButton
              id={a.id}
              initial={{ title: a.title, instructions: a.instructions, dueAt: utcToZonedLocal(a.dueAt, settings.timezone), maxScore: (a.maxScore ?? "") as never, mode: a.mode }}
            />
            <AssignmentStatusControls id={a.id} title={a.title} status={a.status} canDelete={a._count.submissions === 0} />
          </div>
        ) : null}
      </header>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <dt className="text-sm text-muted-foreground">{t("due")}</dt>
          <dd className="font-medium">{formatDateTime(a.dueAt, settings)}</dd>
        </div>
        <div className="rounded-lg border p-4">
          <dt className="text-sm text-muted-foreground">{t("maxScore")}</dt>
          <dd className="font-medium">{a.maxScore !== null ? formatNumber(a.maxScore, settings) : t("notScored")}</dd>
        </div>
        {isStaff ? (
          <div className="rounded-lg border p-4">
            <dt className="text-sm text-muted-foreground">{t("handedIn")}</dt>
            <dd className="font-medium tabular-nums">{a.mode === "ONLINE" ? formatNumber(a._count.submissions, settings) : "—"}</dd>
          </div>
        ) : null}
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>{t("instructions")}</CardTitle>
        </CardHeader>
        <CardContent>{a.instructions ? <p className="whitespace-pre-line text-sm">{a.instructions}</p> : <p className="text-sm text-muted-foreground">{t("noInstructions")}</p>}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("files.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FileList files={a.files} assignmentId={a.id} canRemove={a.canManage} />
          {a.canManage ? (
            storageReady ? (
              <WorksheetUpload assignmentId={a.id} disabled={a.files.length >= MAX_FILES_PER_ASSIGNMENT} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("files.storageOff")}</p>
            )
          ) : null}
        </CardContent>
      </Card>

      {!isStaff && a.mode === "ONLINE" && a.status === "PUBLISHED" ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t("handInSoon")}</p> : null}
      {!isStaff && a.mode === "PAPER" ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t("paperNote")}</p> : null}
    </div>
  );
}
