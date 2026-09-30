"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { recordAudit, withRls } from "@educore/db";
import { todayInTimeZone } from "@/lib/format";
import { assertGradebookAccess, loadGradebook } from "@/lib/gradebook";
import { auditContextFor } from "@/lib/guard";
import { decodeCsvBytes, MAX_FILE_BYTES, parseCsv } from "@/lib/imports/csv";
import { isValidScore } from "@/lib/results";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { mapScoresCsv, type ScoreIssue } from "@/lib/scores-csv";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";

const MAX_CELLS = 300 * 10;

const saveSchema = z.object({
  sectionId: idSchema,
  subjectId: idSchema,
  termId: idSchema,
  cells: z
    .array(
      z.object({
        studentId: idSchema,
        componentId: idSchema,
        // null = clear this score
        score: z.number().finite().nullable(),
      }),
    )
    .max(MAX_CELLS),
});

/**
 * Save gradebook changes (milestone 2.2).
 *
 * Checks, in order: permission; the caller may open THIS gradebook
 * (admin, or the teacher assigned to this subject in this section); the
 * term belongs to the section's year and that year is active; the class's
 * results for the term aren't published (published = locked — an admin
 * unpublishes first); every component is the school's; every student is
 * enrolled in the section; every score is 0…maxScore with ≤ 2 decimals.
 * Then only real changes are written, each audited (Mark CREATE/UPDATE/
 * DELETE with before/after), in one RLS transaction — all or nothing.
 */
export async function saveScores(input: unknown) {
  return runAction(["mark", "update"], async (ctx) => {
    const data = saveSchema.parse(input);
    const t = await getTranslations("gradebook.errors");
    const { section, subject } = await assertGradebookAccess(ctx, data.sectionId, data.subjectId);
    const year = section.class.academicYear;
    if (!year.isActive) throw new UserFacingError(t("yearNotActive"));

    const settings = await getSettingsForUser(ctx.user.tenantId ?? null);
    const today = todayInTimeZone(settings.timezone);
    const audit = auditContextFor(ctx);

    const result = await withRls(audit.tenantId, async (tx) => {
      const term = await tx.term.findFirst({ where: { id: data.termId, tenantId: audit.tenantId, academicYearId: year.id } });
      if (!term) throw new NotFoundError();
      const published = await tx.resultPublication.findFirst({ where: { tenantId: audit.tenantId, termId: term.id, classId: section.classId } });
      if (published) throw new UserFacingError(t("published"));

      const componentIds = [...new Set(data.cells.map((c) => c.componentId))];
      const studentIds = [...new Set(data.cells.map((c) => c.studentId))];
      const [components, enrolled] = await Promise.all([
        tx.assessmentType.findMany({ where: { tenantId: audit.tenantId, id: { in: componentIds } } }),
        tx.student.findMany({ where: { tenantId: audit.tenantId, sectionId: section.id, status: "ACTIVE", id: { in: studentIds } }, select: { id: true } }),
      ]);
      if (components.length !== componentIds.length || enrolled.length !== studentIds.length) throw new NotFoundError();

      // One assessment (gradebook column) per component; created the first time a score is entered.
      let assessments = await tx.assessment.findMany({
        where: { tenantId: audit.tenantId, termId: term.id, sectionId: section.id, subjectId: subject.id, assessmentTypeId: { in: componentIds } },
      });
      const clampDate = today < term.startDate ? term.startDate : today > term.endDate ? term.endDate : today;
      for (const c of components) {
        if (assessments.some((a) => a.assessmentTypeId === c.id)) continue;
        if (!data.cells.some((cell) => cell.componentId === c.id && cell.score !== null)) continue;
        const created = await tx.assessment.create({
          data: {
            tenantId: audit.tenantId,
            academicYearId: year.id,
            termId: term.id,
            sectionId: section.id,
            subjectId: subject.id,
            assessmentTypeId: c.id,
            name: `${subject.name} · ${c.name}`,
            maxScore: c.weight,
            date: clampDate,
          },
        });
        await recordAudit(audit, { action: "CREATE", entityType: "Assessment", entityId: created.id, after: created }, tx);
        assessments = [...assessments, created];
      }
      const assessmentFor = new Map(assessments.map((a) => [a.assessmentTypeId, a]));

      for (const cell of data.cells) {
        const a = assessmentFor.get(cell.componentId);
        if (cell.score !== null && (!a || !isValidScore(cell.score, a.maxScore))) {
          const name = components.find((c) => c.id === cell.componentId)?.name ?? "";
          throw new UserFacingError(t("outOfRange", { component: name, max: a?.maxScore ?? 0 }));
        }
      }

      const existing = await tx.mark.findMany({
        where: { tenantId: audit.tenantId, assessmentId: { in: assessments.map((a) => a.id) }, studentId: { in: studentIds } },
      });
      const markKey = (assessmentId: string, studentId: string) => `${assessmentId}:${studentId}`;
      const byKey = new Map(existing.map((m) => [markKey(m.assessmentId, m.studentId), m]));

      let created = 0;
      let updated = 0;
      let cleared = 0;
      for (const cell of data.cells) {
        const a = assessmentFor.get(cell.componentId);
        if (!a) continue; // clearing a column that was never created: nothing to do
        const before = byKey.get(markKey(a.id, cell.studentId));
        if (cell.score === null) {
          if (!before) continue;
          await tx.mark.delete({ where: { id: before.id } });
          await recordAudit(audit, { action: "DELETE", entityType: "Mark", entityId: before.id, before }, tx);
          cleared++;
        } else if (!before) {
          const after = await tx.mark.create({
            data: { tenantId: audit.tenantId, assessmentId: a.id, studentId: cell.studentId, score: cell.score, enteredById: ctx.user.id },
          });
          await recordAudit(audit, { action: "CREATE", entityType: "Mark", entityId: after.id, after }, tx);
          created++;
        } else if (before.score !== cell.score) {
          const after = await tx.mark.update({ where: { id: before.id }, data: { score: cell.score, enteredById: ctx.user.id } });
          await recordAudit(audit, { action: "UPDATE", entityType: "Mark", entityId: after.id, before, after }, tx);
          updated++;
        }
      }
      return { created, updated, cleared };
    }, { timeoutMs: 30_000 });

    revalidatePath("/assessments", "layout");
    return result;
  });
}

/**
 * Read a score file into the gradebook (nothing is saved): returns cells
 * for the grid plus a row-by-row problem list. The teacher checks the grid,
 * then saves as usual (audited).
 */
export async function readScoresFile(formData: FormData) {
  return runAction(["mark", "update"], async (ctx) => {
    const t = await getTranslations("gradebook.import");
    const file = formData.get("file");
    const sectionId = idSchema.parse(formData.get("sectionId"));
    const subjectId = idSchema.parse(formData.get("subjectId"));
    const termId = idSchema.parse(formData.get("termId"));
    if (!(file instanceof File) || file.size === 0) throw new UserFacingError(t("noFile"));
    if (file.size > MAX_FILE_BYTES) throw new UserFacingError(t("tooLarge"));
    if (/\.xlsx?$/i.test(file.name)) throw new UserFacingError(t("excel"));

    const settings = await getSettingsForUser(ctx.user.tenantId ?? null);
    const book = await loadGradebook(ctx, sectionId, subjectId, termId, settings.timezone);
    if (book.range.term?.id !== termId) throw new NotFoundError();

    const parsed = parseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
    const mapped = mapScoresCsv(
      parsed,
      book.rows.map((r) => r.student),
      book.components.map((c) => ({ id: c.id, name: c.name, maxScore: c.maxScore })),
    );
    return { ...mapped, issues: mapped.issues.map((i) => ({ row: i.row, message: describeIssue(t, i) })) };
  });
}

function describeIssue(t: Awaited<ReturnType<typeof getTranslations<"gradebook.import">>>, i: ScoreIssue): string {
  switch (i.code) {
    case "noAdmissionColumn":
      return t("issues.noAdmissionColumn");
    case "noComponentColumns":
      return t("issues.noComponentColumns");
    case "unknownStudent":
      return t("issues.unknownStudent", { value: i.value });
    case "duplicateStudent":
      return t("issues.duplicateStudent", { value: i.value });
    case "notANumber":
      return t("issues.notANumber", { column: i.column, value: i.value });
    case "outOfRange":
      return t("issues.outOfRange", { column: i.column, value: i.value, max: i.max });
  }
}
