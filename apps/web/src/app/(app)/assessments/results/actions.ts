"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditedMutation } from "@educore/db";
import { auditContextFor } from "@/lib/guard";
import { NotFoundError, runAction } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";

const schema = z.object({ classId: idSchema, termId: idSchema });

/**
 * Publish a class's results for a term: parents and students can see them,
 * and scores are locked (the gradebook refuses changes). Admins only;
 * audited. Both ids are re-checked against this school.
 */
export async function publishResults(input: unknown) {
  return runAction(["results", "update"], async (ctx) => {
    const { classId, termId } = schema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "CREATE",
      entityType: "ResultPublication",
      run: async (tx) => {
        const cls = await tx.classGrade.findFirst({ where: { id: classId, tenantId: audit.tenantId } });
        const term = await tx.term.findFirst({ where: { id: termId, tenantId: audit.tenantId } });
        if (!cls || !term || term.academicYearId !== cls.academicYearId) throw new NotFoundError();
        const existing = await tx.resultPublication.findFirst({ where: { tenantId: audit.tenantId, termId, classId } });
        if (existing) return { after: existing }; // already published: nothing to do
        const after = await tx.resultPublication.create({
          data: { tenantId: audit.tenantId, termId, classId, publishedById: ctx.user.id },
        });
        return { after };
      },
    });
    revalidatePath("/assessments", "layout");
    revalidatePath("/students", "layout");
  });
}

/**
 * Take results back down (e.g. to correct a score). Families stop seeing
 * them, scores unlock, and the class's report cards for the term must be
 * regenerated. Audited.
 */
export async function unpublishResults(input: unknown) {
  return runAction(["results", "update"], async (ctx) => {
    const { classId, termId } = schema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "ResultPublication",
      run: async (tx) => {
        const before = await tx.resultPublication.findFirst({ where: { tenantId: audit.tenantId, termId, classId } });
        if (!before) throw new NotFoundError();
        await tx.resultPublication.delete({ where: { id: before.id } });
        // Scores may now change, so the class's generated report cards are no
        // longer trustworthy: back to "not generated" until regenerated.
        await tx.reportCard.updateMany({
          where: { tenantId: audit.tenantId, termId, student: { classId }, status: "READY" },
          data: { status: "PENDING" },
        });
        return { before, after: before };
      },
    });
    revalidatePath("/assessments", "layout");
    revalidatePath("/students", "layout");
  });
}
