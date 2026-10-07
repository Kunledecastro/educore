import { Prisma, recordAudit, withRls, type ImportJob, type PrismaClient } from "@educore/db";
import { applyRows, MAX_STORED_ISSUES, validateCsv } from "@/lib/imports/engine";
import { describeImportError } from "@/lib/imports/errors";
import { IMPORTERS } from "@/lib/imports/registry";
import type { ImportOptions, RowIssue } from "@/lib/imports/types";
import { inngest } from "./client";

/** Rows per step. Each step is its own short serverless invocation and its own transaction. */
export const BATCH_SIZE = 50;

async function loadJob(tx: PrismaClient, jobId: string, tenantId: string): Promise<ImportJob | null> {
  // RLS already limits this to the event's school; the explicit tenantId keeps the intent obvious.
  return tx.importJob.findFirst({ where: { id: jobId, tenantId } });
}

/**
 * Runs a confirmed import in the background, BATCH_SIZE rows per step.
 *
 * - One import at a time per school (concurrency key), so two imports can't
 *   race on the same students.
 * - Steps are memoised by Inngest: if a step fails it's retried on its own,
 *   and a crash resumes from the last finished batch instead of restarting.
 * - Every batch re-validates the file against CURRENT data before writing,
 *   so anything that changed since the preview (a class was deleted, say) is
 *   caught per row instead of written blindly.
 * - Writes happen in the school's RLS transaction with audit entries; a
 *   cancelled job stops at the next batch.
 */
export const runImport = inngest.createFunction(
  {
    id: "run-import",
    name: "Run CSV import",
    concurrency: { key: "event.data.tenantId", limit: 1 },
    retries: 3,
    onFailure: async ({ event }) => {
      const { jobId, tenantId } = event.data.event.data;
      await withRls(tenantId, (tx) =>
        tx.importJob.updateMany({
          where: { id: jobId, tenantId, status: { in: ["QUEUED", "IMPORTING"] } },
          data: { status: "FAILED", finishedAt: new Date() },
        }),
      );
    },
  },
  { event: "educore/import.requested" },
  async ({ event, step }) => {
    const { jobId, tenantId } = event.data;

    const plan = await step.run("start", () =>
      withRls(tenantId, async (tx) => {
        const job = await loadJob(tx, jobId, tenantId);
        if (!job || job.status !== "QUEUED") return null;
        const importer = IMPORTERS[job.kind];
        const ctx = { tenantId, actorId: job.createdById, options: job.options as ImportOptions };
        const report = validateCsv(importer, job.csv, await importer.loadLookup(tx, ctx));
        await tx.importJob.update({ where: { id: job.id }, data: { status: "IMPORTING", startedAt: new Date(), processedRows: 0 } });
        return { lines: [...report.valid.keys()] };
      }),
    );
    if (!plan) return { skipped: true };

    const totals = { created: 0, updated: 0, failed: 0 };
    const issues: RowIssue[] = [];

    for (let start = 0; start < plan.lines.length; start += BATCH_SIZE) {
      const lines = plan.lines.slice(start, start + BATCH_SIZE);
      const batch = await step.run(`rows-${start + 1}-${start + lines.length}`, () =>
        withRls(
          tenantId,
          async (tx) => {
            const job = await loadJob(tx, jobId, tenantId);
            if (!job || job.status !== "IMPORTING") return { cancelled: true as const };
            const importer = IMPORTERS[job.kind];
            const ctx = { tenantId, actorId: job.createdById, options: job.options as ImportOptions };
            const report = validateCsv(importer, job.csv, await importer.loadLookup(tx, ctx));

            const rows = [];
            const stale: RowIssue[] = [];
            for (const line of lines) {
              const row = report.valid.get(line);
              if (row) rows.push({ line, row });
              else {
                const now = report.issues.filter((i) => i.row === line);
                stale.push(...(now.length ? now : [{ row: line, column: null, message: "imports.issues.changedSincePreview" }]));
              }
            }
            const result = await applyRows(tx, importer, ctx, rows, describeImportError);
            await tx.importJob.update({ where: { id: job.id }, data: { processedRows: start + lines.length } });
            return {
              cancelled: false as const,
              created: result.created,
              updated: result.updated,
              failed: result.failed + new Set(stale.map((s) => s.row)).size,
              issues: [...stale, ...result.issues],
            };
          },
          { timeoutMs: 55_000 },
        ),
      );
      if (batch.cancelled) return { cancelled: true };
      totals.created += batch.created;
      totals.updated += batch.updated;
      totals.failed += batch.failed;
      issues.push(...batch.issues);
    }

    await step.run("finish", () =>
      withRls(tenantId, async (tx) => {
        const job = await loadJob(tx, jobId, tenantId);
        if (!job || job.status !== "IMPORTING") return;
        const after = await tx.importJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            finishedAt: new Date(),
            // Data minimisation: the uploaded file (names, emails, birth dates) isn't kept once it's imported.
            csv: "",
            processedRows: plan.lines.length,
            createdRows: totals.created,
            updatedRows: totals.updated,
            failedRows: totals.failed,
            importErrors: issues.slice(0, MAX_STORED_ISSUES) as unknown as Prisma.InputJsonValue,
          },
          select: { id: true, kind: true, fileName: true, status: true, createdRows: true, updatedRows: true, failedRows: true },
        });
        await recordAudit(
          { tenantId, actorId: job.createdById, ipAddress: null, userAgent: "EduCore import" },
          { action: "UPDATE", entityType: "ImportJob", entityId: job.id, after },
          tx,
        );
      }),
    );
    return totals;
  },
);

// Every background function is registered once, in app/api/inngest/route.ts via FUNCTIONS.
export { generateReportCards } from "./generate-report-cards";
export { billTerm } from "./bill-term";
import { billTerm } from "./bill-term";
import { generateReportCards } from "./generate-report-cards";
import { notifyMessage } from "./notify-message";
import { renewSubscriptions } from "./renew-subscriptions";
import { cleanUploads, notifyAssignmentFeedback } from "./assignment-jobs";
import { healthRetention, notifyClinicVisit } from "./health-jobs";
export const FUNCTIONS = [runImport, generateReportCards, billTerm, renewSubscriptions, notifyMessage, notifyAssignmentFeedback, cleanUploads, notifyClinicVisit, healthRetention];
