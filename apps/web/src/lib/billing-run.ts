import "server-only";
import { forTenant, Prisma, recordAudit, withRls } from "@educore/db";
import { fromMinor, toMinor } from "./fees";
import { billsFor } from "./fees-data";
import { createInvoice } from "./invoice-writer";
import { getTenantSettingsById } from "./tenant-settings-server";

/**
 * The steps of a "bill the term" run (milestone 3.1), called by the Inngest
 * function in lib/inngest/bill-term.ts — and directly by the integration
 * tests. Each step is one short transaction.
 */

/** Students per step: one short invocation and one transaction each. */
export const STUDENTS_PER_STEP = 50;

export type RunPlan = { termId: string; createdById: string | null; dueDate: string; studentIds: string[] };

/** QUEUED → RUNNING; fixes the list of students to bill. Null if the run isn't waiting. */
export function startRun(tenantId: string, runId: string): Promise<RunPlan | null> {
  return withRls(tenantId, async (tx) => {
    const run = await tx.billingRun.findFirst({ where: { id: runId, tenantId }, include: { term: true } });
    if (!run || run.status !== "QUEUED") return null;
    const classIds = (run.classIds as string[]) ?? [];
    const students = await tx.student.findMany({
      where: { tenantId, status: "ACTIVE", classId: { in: classIds }, class: { academicYearId: run.term.academicYearId } },
      select: { id: true },
      orderBy: [{ class: { order: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
    });
    await tx.billingRun.update({ where: { id: run.id }, data: { status: "RUNNING", total: students.length, done: 0 } });
    return { termId: run.termId, createdById: run.createdById, dueDate: run.dueDate.toISOString(), studentIds: students.map((s) => s.id) };
  });
}

/**
 * Bills one batch. Never double-bills: students with a live invoice for the
 * term are skipped, and the database allows only one live invoice per
 * student per term — a retried step racing itself is caught per student
 * (SAVEPOINT) and counted as skipped. Empty bills (no fees set) are skipped.
 */
export async function billBatch(tenantId: string, runId: string, plan: RunPlan, offset: number, batch: string[]) {
  const db = forTenant(tenantId);
  const settings = await getTenantSettingsById(tenantId);
  const term = await db.term.findFirstOrThrow({ where: { id: plan.termId }, include: { academicYear: { select: { startDate: true } } } });
  const bills = await billsFor(db, term, batch);
  const audit = { tenantId, actorId: plan.createdById, ipAddress: null, userAgent: "EduCore billing" };
  await withRls(
    tenantId,
    async (tx) => {
      const run = await tx.billingRun.findFirstOrThrow({ where: { id: runId, tenantId } });
      if (run.status !== "RUNNING") return;
      const live = await tx.invoice.findMany({
        where: { tenantId, termId: term.id, studentId: { in: batch }, status: { not: "CANCELLED" } },
        select: { studentId: true },
      });
      const already = new Set(live.map((l) => l.studentId));
      let created = 0;
      let skipped = 0;
      let amountMinor = 0;
      for (const studentId of batch) {
        const bill = bills.get(studentId);
        if (already.has(studentId) || !bill || bill.lines.length === 0) {
          skipped++;
          continue;
        }
        await tx.$executeRawUnsafe("SAVEPOINT bill_student");
        try {
          await createInvoice(tx, audit, {
            studentId,
            term: { id: term.id, academicYearId: term.academicYearId, yearStart: term.academicYear.startDate },
            bill,
            dueDate: new Date(plan.dueDate),
            currency: settings.currency,
            prefix: settings.invoicePrefix,
            billingRunId: runId,
          });
          await tx.$executeRawUnsafe("RELEASE SAVEPOINT bill_student");
          created++;
          amountMinor += bill.totalMinor;
        } catch (err) {
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT bill_student");
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") skipped++;
          else throw err;
        }
      }
      await tx.billingRun.update({
        where: { id: runId },
        data: {
          done: Math.min(offset + batch.length, plan.studentIds.length),
          created: run.created + created,
          skipped: run.skipped + skipped,
          amount: fromMinor((toMinor(run.amount) ?? 0) + amountMinor),
        },
      });
    },
    { timeoutMs: 55_000 },
  );
}

export function finishRun(tenantId: string, runId: string, plan: RunPlan) {
  return withRls(tenantId, async (tx) => {
    const after = await tx.billingRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", finishedAt: new Date(), done: plan.studentIds.length },
    });
    await recordAudit(
      { tenantId, actorId: plan.createdById, ipAddress: null, userAgent: "EduCore billing" },
      { action: "UPDATE", entityType: "BillingRun", entityId: runId, after },
      tx,
    );
    return { created: after.created, skipped: after.skipped };
  });
}
