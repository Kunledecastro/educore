"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { Prisma, recordAudit, withRls } from "@educore/db";
import { can } from "@educore/auth";
import { fail, type ActionResult } from "@/lib/action-result";
import { auditContextFor, requireUser } from "@/lib/guard";
import { decodeCsvBytes, MAX_FILE_BYTES } from "@/lib/imports/csv";
import { validateCsv } from "@/lib/imports/engine";
import { IMPORTERS, isImportKind } from "@/lib/imports/registry";
import { inngest } from "@/lib/inngest/client";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";

const CSV_TYPES = new Set(["text/csv", "application/vnd.ms-excel", "text/plain", "application/csv", "text/x-csv", ""]);

/**
 * Step 1 of an import: upload + validate. Nothing is written except the
 * import record itself (file + validation report). Permission depends on
 * what's being imported, so it's checked after reading `kind`.
 */
export async function uploadImport(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const kind = formData.get("kind");
  if (!isImportKind(kind)) {
    const t = await getTranslations("actionErrors");
    return fail(t("invalid"));
  }
  const importer = IMPORTERS[kind];

  return runAction(importer.permission, async (ctx) => {
    const t = await getTranslations("imports.errors");
    const audit = auditContextFor(ctx);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserFacingError(t("noFile"), { file: t("noFile") });
    if (/\.(xlsx|xls|numbers|ods)$/i.test(file.name)) throw new UserFacingError(t("notCsvExcel"), { file: t("notCsvExcel") });
    if (!/\.(csv|txt)$/i.test(file.name) || !CSV_TYPES.has(file.type)) throw new UserFacingError(t("notCsv"), { file: t("notCsv") });
    if (file.size > MAX_FILE_BYTES) throw new UserFacingError(t("tooLarge"), { file: t("tooLarge") });

    const csv = decodeCsvBytes(new Uint8Array(await file.arrayBuffer())).replace(/\u0000/g, "");
    const options: Record<string, string> = {};
    if (importer.needsYear) options.academicYearId = idSchema.parse(formData.get("academicYearId"));

    const job = await withRls(audit.tenantId, async (tx) => {
      if (options.academicYearId) {
        const year = await tx.academicYear.findFirst({ where: { id: options.academicYearId, tenantId: audit.tenantId } });
        if (!year) throw new NotFoundError();
      }
      const lookup = await importer.loadLookup(tx, { tenantId: audit.tenantId, actorId: audit.actorId, options });
      const report = validateCsv(importer, csv, lookup);
      const created = await tx.importJob.create({
        data: {
          tenantId: audit.tenantId,
          createdById: audit.actorId,
          kind,
          status: "VALIDATED",
          fileName: file.name.slice(0, 200),
          csv,
          options,
          totalRows: report.totalRows,
          validRows: report.fatal ? 0 : report.valid.size,
          errorRows: report.errorRows,
          errors: report.issues as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, kind: true, fileName: true, totalRows: true, validRows: true, errorRows: true },
      });
      await recordAudit(audit, { action: "CREATE", entityType: "ImportJob", entityId: created.id, after: created }, tx);
      return created;
    });
    revalidatePath("/imports");
    return { id: job.id };
  });
}

/** Loads a job the current user may act on, checking the permission for ITS kind. */
async function jobFor(id: string) {
  const ctx = await requireUser();
  const job = await ctx.db.importJob.findUnique({ where: { id } });
  if (!job) throw new NotFoundError();
  const importer = IMPORTERS[job.kind];
  if (!can(ctx.user.role, importer.permission[0], importer.permission[1])) throw new NotFoundError();
  return { ctx, job };
}

/** Step 2: the admin confirms. Valid rows are imported in the background. */
export async function startImport(jobId: unknown) {
  return runAction(["user", "read"], async () => {
    const id = idSchema.parse(jobId);
    const t = await getTranslations("imports.errors");
    const { ctx, job } = await jobFor(id);
    const audit = auditContextFor(ctx);
    if (job.status !== "VALIDATED") throw new UserFacingError(t("alreadyStarted"));
    if (job.validRows === 0) throw new UserFacingError(t("nothingToImport"));

    // Claim atomically so a double-click can't queue two runs.
    const claimed = await withRls(audit.tenantId, (tx) =>
      tx.importJob.updateMany({ where: { id: job.id, tenantId: audit.tenantId, status: "VALIDATED" }, data: { status: "QUEUED" } }),
    );
    if (claimed.count !== 1) throw new UserFacingError(t("alreadyStarted"));

    try {
      await inngest.send({ name: "educore/import.requested", data: { jobId: job.id, tenantId: audit.tenantId } });
    } catch (err) {
      console.error("[import] could not queue background job", err);
      await withRls(audit.tenantId, (tx) =>
        tx.importJob.updateMany({ where: { id: job.id, tenantId: audit.tenantId, status: "QUEUED" }, data: { status: "VALIDATED" } }),
      );
      throw new UserFacingError(t("queueUnavailable"));
    }
    await recordAudit(audit, { action: "UPDATE", entityType: "ImportJob", entityId: job.id, after: { status: "QUEUED" } });
    revalidatePath(`/imports/${job.id}`);
    revalidatePath("/imports");
  });
}

/** Cancels an import that hasn't finished. Rows already written stay (each is audited). */
export async function cancelImport(jobId: unknown) {
  return runAction(["user", "read"], async () => {
    const id = idSchema.parse(jobId);
    const t = await getTranslations("imports.errors");
    const { ctx, job } = await jobFor(id);
    const audit = auditContextFor(ctx);
    const res = await withRls(audit.tenantId, (tx) =>
      tx.importJob.updateMany({
        where: { id: job.id, tenantId: audit.tenantId, status: { in: ["VALIDATED", "QUEUED", "IMPORTING"] } },
        data: { status: "CANCELLED", finishedAt: new Date(), csv: "" },
      }),
    );
    if (res.count !== 1) throw new UserFacingError(t("cannotCancel"));
    await recordAudit(audit, { action: "UPDATE", entityType: "ImportJob", entityId: job.id, after: { status: "CANCELLED" } });
    revalidatePath(`/imports/${job.id}`);
    revalidatePath("/imports");
  });
}
