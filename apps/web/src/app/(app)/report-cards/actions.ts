"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { recordAudit, Role, withRls } from "@educore/db";
import { auditContextFor } from "@/lib/guard";
import { inngest } from "@/lib/inngest/client";
import { MAX_COMMENT_LENGTH } from "@/lib/report-card";
import { loadReportCardSection, STALE_RUN_MS } from "@/lib/report-card-data";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";

const comment = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() || null : v === undefined ? undefined : null),
  z.string().max(MAX_COMMENT_LENGTH, "tooLong").nullable().optional(),
);

const commentsSchema = z.object({
  sectionId: idSchema,
  termId: idSchema,
  rows: z
    .array(z.object({ studentId: idSchema, teacherComment: comment, principalComment: comment }))
    .max(300),
});

/**
 * Save report-card comments for a section and term (milestone 2.3).
 * Form teachers write the teacher's comment for their own sections; admins
 * write both. A teacher can never set the principal's comment — the field
 * is ignored for them. Students must be enrolled in the section; the term
 * must be in the section's (active) year. Each change is audited.
 */
export async function saveComments(input: unknown) {
  return runAction(["reportCard", "update"], async (ctx) => {
    const t = await getTranslations("reportCards.errors");
    const parsed = commentsSchema.safeParse(input);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.message === "tooLong")) throw new UserFacingError(t("tooLong"));
      throw parsed.error;
    }
    const data = parsed.data;
    const section = await loadReportCardSection(ctx, data.sectionId);
    const isAdmin = ctx.user.role === Role.SCHOOL_ADMIN;
    const year = section.class.academicYear;
    const audit = auditContextFor(ctx);

    const changed = await withRls(audit.tenantId, async (tx) => {
      const term = await tx.term.findFirst({ where: { id: data.termId, tenantId: audit.tenantId, academicYearId: year.id } });
      if (!term) throw new NotFoundError();
      const ids = [...new Set(data.rows.map((r) => r.studentId))];
      const enrolled = await tx.student.count({ where: { tenantId: audit.tenantId, sectionId: section.id, status: "ACTIVE", id: { in: ids } } });
      if (enrolled !== ids.length) throw new NotFoundError();

      const existing = new Map(
        (await tx.reportCard.findMany({ where: { tenantId: audit.tenantId, termId: term.id, studentId: { in: ids } } })).map((c) => [c.studentId, c]),
      );
      let count = 0;
      for (const row of data.rows) {
        const before = existing.get(row.studentId);
        const next = {
          teacherComment: row.teacherComment === undefined ? (before?.teacherComment ?? null) : row.teacherComment,
          // Teachers can't touch the principal's comment.
          principalComment: !isAdmin || row.principalComment === undefined ? (before?.principalComment ?? null) : row.principalComment,
        };
        if (before && before.teacherComment === next.teacherComment && before.principalComment === next.principalComment) continue;
        if (!before && !next.teacherComment && !next.principalComment) continue;
        if (before) {
          const after = await tx.reportCard.update({ where: { id: before.id }, data: next });
          await recordAudit(audit, { action: "UPDATE", entityType: "ReportCard", entityId: after.id, before: { ...before, snapshot: undefined }, after: { ...after, snapshot: undefined } }, tx);
        } else {
          const after = await tx.reportCard.create({
            data: { tenantId: audit.tenantId, studentId: row.studentId, termId: term.id, academicYearId: year.id, ...next },
          });
          await recordAudit(audit, { action: "CREATE", entityType: "ReportCard", entityId: after.id, after }, tx);
        }
        count++;
      }
      return count;
    });
    revalidatePath("/report-cards", "layout");
    return { changed };
  });
}

const generateSchema = z.object({ sectionId: idSchema, termId: idSchema });

/**
 * Start generating a section's report cards (admins). Needs the class's
 * results for the term to be published; refuses while a generation for the
 * same section and term is still running. The work runs in the background.
 */
export async function generateReportCardsAction(input: unknown) {
  return runAction(["reportCard", "create"], async (ctx) => {
    const t = await getTranslations("reportCards.errors");
    const { sectionId, termId } = generateSchema.parse(input);
    const section = await loadReportCardSection(ctx, sectionId);
    const audit = auditContextFor(ctx);

    const run = await withRls(audit.tenantId, async (tx) => {
      const term = await tx.term.findFirst({ where: { id: termId, tenantId: audit.tenantId, academicYearId: section.class.academicYearId } });
      if (!term) throw new NotFoundError();
      const published = await tx.resultPublication.findFirst({ where: { tenantId: audit.tenantId, termId, classId: section.classId } });
      if (!published) throw new UserFacingError(t("notPublished"));
      const active = await tx.reportCardRun.findFirst({
        where: { tenantId: audit.tenantId, termId, sectionId, status: { in: ["QUEUED", "RUNNING"] }, createdAt: { gt: new Date(Date.now() - STALE_RUN_MS) } },
      });
      if (active) throw new UserFacingError(t("alreadyRunning"));
      const total = await tx.student.count({ where: { tenantId: audit.tenantId, sectionId, status: "ACTIVE" } });
      if (total === 0) throw new UserFacingError(t("noStudents"));
      const created = await tx.reportCardRun.create({
        data: { tenantId: audit.tenantId, termId, sectionId, total, createdById: ctx.user.id },
      });
      await recordAudit(audit, { action: "CREATE", entityType: "ReportCardRun", entityId: created.id, after: created }, tx);
      return created;
    });

    try {
      await inngest.send({ name: "educore/report-cards.requested", data: { runId: run.id, tenantId: audit.tenantId } });
    } catch (err) {
      console.error("[report-cards] could not queue generation", err);
      await withRls(audit.tenantId, (tx) =>
        tx.reportCardRun.update({ where: { id: run.id }, data: { status: "FAILED", error: "queue", finishedAt: new Date() } }),
      );
      throw new UserFacingError(t("queueFailed"));
    }
    revalidatePath("/report-cards", "layout");
    return { runId: run.id };
  });
}
