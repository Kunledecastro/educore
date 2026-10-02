import { forTenant, Prisma, recordAudit, withRls } from "@educore/db";
import { buildSectionSnapshots } from "@/lib/report-card-data";
import { inngest } from "./client";

/** Students per step: each step is one short invocation and one transaction. */
export const CARDS_PER_STEP = 20;

/**
 * Generates a section's report cards for a term (milestone 2.3,
 * architecture rule #7). Freezes each student's card into its `snapshot`;
 * PDFs are drawn from snapshots on download.
 *
 * - One generation at a time per school (concurrency key).
 * - Re-checks at the start that the class's results are still published —
 *   cards only ever show published results.
 * - Batches are memoised by Inngest: a failed batch retries on its own.
 * - Progress (`done`/`total`) is written after every batch for the UI.
 */
export const generateReportCards = inngest.createFunction(
  {
    id: "generate-report-cards",
    name: "Generate report cards",
    concurrency: { key: "event.data.tenantId", limit: 1 },
    retries: 2,
    onFailure: async ({ event }) => {
      const { runId, tenantId } = event.data.event.data;
      await withRls(tenantId, (tx) =>
        tx.reportCardRun.updateMany({
          where: { id: runId, tenantId, status: { in: ["QUEUED", "RUNNING"] } },
          data: { status: "FAILED", finishedAt: new Date(), error: "failed" },
        }),
      );
    },
  },
  { event: "educore/report-cards.requested" },
  async ({ event, step }) => {
    const { runId, tenantId } = event.data;

    const plan = await step.run("start", () =>
      withRls(tenantId, async (tx) => {
        const run = await tx.reportCardRun.findFirst({ where: { id: runId, tenantId }, include: { section: { select: { classId: true } } } });
        if (!run || run.status !== "QUEUED") return null;
        const published = await tx.resultPublication.findFirst({ where: { tenantId, termId: run.termId, classId: run.section.classId } });
        if (!published) {
          await tx.reportCardRun.update({ where: { id: run.id }, data: { status: "FAILED", error: "notPublished", finishedAt: new Date() } });
          return null;
        }
        const students = await tx.student.findMany({
          where: { tenantId, sectionId: run.sectionId, status: "ACTIVE" },
          select: { id: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        });
        await tx.reportCardRun.update({ where: { id: run.id }, data: { status: "RUNNING", total: students.length, done: 0 } });
        return { termId: run.termId, sectionId: run.sectionId, createdById: run.createdById, studentIds: students.map((s) => s.id) };
      }),
    );
    if (!plan) return { skipped: true };

    for (let i = 0; i < plan.studentIds.length; i += CARDS_PER_STEP) {
      const batch = plan.studentIds.slice(i, i + CARDS_PER_STEP);
      await step.run(`cards-${i}`, async () => {
        const now = new Date();
        const snapshots = await buildSectionSnapshots(forTenant(tenantId), { tenantId, termId: plan.termId, sectionId: plan.sectionId, studentIds: batch, now });
        await withRls(tenantId, async (tx) => {
          const term = await tx.term.findFirstOrThrow({ where: { id: plan.termId, tenantId }, select: { academicYearId: true } });
          for (const [studentId, snapshot] of snapshots) {
            const data = { snapshot: snapshot as unknown as Prisma.InputJsonValue, status: "READY" as const, generatedAt: now, updatedAt: now };
            await tx.reportCard.upsert({
              where: { tenantId_studentId_termId: { tenantId, studentId, termId: plan.termId } },
              create: { tenantId, studentId, termId: plan.termId, academicYearId: term.academicYearId, ...data },
              update: data,
            });
          }
          await tx.reportCardRun.update({ where: { id: runId }, data: { done: Math.min(i + batch.length, plan.studentIds.length) } });
        });
      });
    }

    await step.run("finish", () =>
      withRls(tenantId, async (tx) => {
        const after = await tx.reportCardRun.update({
          where: { id: runId },
          data: { status: "COMPLETED", finishedAt: new Date(), done: plan.studentIds.length },
        });
        await recordAudit(
          { tenantId, actorId: plan.createdById, ipAddress: null, userAgent: "EduCore report cards" },
          { action: "UPDATE", entityType: "ReportCardRun", entityId: runId, after },
          tx,
        );
      }),
    );
    return { generated: plan.studentIds.length };
  },
);
