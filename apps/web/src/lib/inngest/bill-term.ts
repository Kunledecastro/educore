import { withRls } from "@educore/db";
import { billBatch, finishRun, startRun, STUDENTS_PER_STEP } from "@/lib/billing-run";
import { inngest } from "./client";

/**
 * "Bill the term" (milestone 3.1, architecture rule #7): one invoice per
 * active student of the chosen classes, from the same billsFor() the
 * preview showed.
 *
 * - One billing run at a time per school (concurrency key).
 * - Never double-bills: students who already have a live invoice for the
 *   term are skipped, and the database allows only one live invoice per
 *   student per term — a retried step that races itself is caught per
 *   student (SAVEPOINT) and counted as skipped.
 * - Students whose bill is empty (no fees set for their class) are skipped.
 * - Each invoice and its audit entry commit together; progress is saved
 *   after every batch for the UI.
 */
export const billTerm = inngest.createFunction(
  {
    id: "bill-term",
    name: "Bill the term",
    concurrency: { key: "event.data.tenantId", limit: 1 },
    retries: 2,
    onFailure: async ({ event }) => {
      const { runId, tenantId } = event.data.event.data;
      await withRls(tenantId, (tx) =>
        tx.billingRun.updateMany({
          where: { id: runId, tenantId, status: { in: ["QUEUED", "RUNNING"] } },
          data: { status: "FAILED", finishedAt: new Date(), error: "failed" },
        }),
      );
    },
  },
  { event: "educore/billing.requested" },
  async ({ event, step }) => {
    const { runId, tenantId } = event.data;

    const plan = await step.run("start", () => startRun(tenantId, runId));
    if (!plan) return { skipped: true };

    for (let i = 0; i < plan.studentIds.length; i += STUDENTS_PER_STEP) {
      const batch = plan.studentIds.slice(i, i + STUDENTS_PER_STEP);
      await step.run(`students-${i + 1}-${i + batch.length}`, () => billBatch(tenantId, runId, plan, i, batch));
    }

    return step.run("finish", () => finishRun(tenantId, runId, plan));
  },
);
