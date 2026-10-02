"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditedMutation, type PrismaClient } from "@educore/db";
import { auditContextFor } from "@/lib/guard";
import { validateGradeBands, validateScoreComponents } from "@/lib/grading";
import { InUseError, NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { resolveCurrentTerm, suggestTerms, validateTerm, type TermIssue } from "@/lib/terms";
import { idSchema } from "@/lib/validation/common";
import { academicOptionsSchema, gradeBandsFormSchema, scoreComponentsFormSchema, termSchema } from "@/lib/validation/settings";

/**
 * Academic settings (milestone 2.0). Same rules as every other action:
 * permission first (runAction), Zod-validated input, one RLS transaction
 * with its audit entry (auditedMutation), and every id we're GIVEN is
 * re-checked against this school (FK checks ignore RLS).
 */

const PATH = "/settings";

async function must<T>(row: Promise<T | null>): Promise<T> {
  const found = await row;
  if (!found) throw new NotFoundError();
  return found;
}

async function termError(issues: TermIssue[]): Promise<never> {
  const t = await getTranslations("settings.terms.errors");
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.code === "endBeforeStart") fieldErrors.endDate ??= t("endBeforeStart");
    if (issue.code === "outsideYear") fieldErrors.startDate ??= t("outsideYear");
    if (issue.code === "overlaps") fieldErrors.startDate ??= t("overlaps", { name: issue.otherName });
  }
  const first = issues[0]!;
  throw new UserFacingError(
    first.code === "overlaps" ? t("overlaps", { name: first.otherName }) : t(first.code),
    Object.keys(fieldErrors).length ? fieldErrors : undefined,
  );
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export async function createTerm(input: unknown) {
  return runAction(["academicSettings", "create"], async (ctx) => {
    const data = termSchema.parse(input);
    const audit = auditContextFor(ctx);
    const term = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "Term",
      run: async (tx) => {
        const year = await must(tx.academicYear.findFirst({ where: { id: data.academicYearId, tenantId: audit.tenantId } }));
        const others = await tx.term.findMany({ where: { tenantId: audit.tenantId, academicYearId: year.id } });
        const issues = validateTerm(data, year, others);
        if (issues.length) await termError(issues);
        const hasCurrent = (await tx.term.count({ where: { tenantId: audit.tenantId, isCurrent: true } })) > 0;
        const after = await tx.term.create({
          data: {
            tenantId: audit.tenantId,
            academicYearId: year.id,
            name: data.name,
            order: Math.max(0, ...others.map((o) => o.order)) + 1,
            startDate: data.startDate,
            endDate: data.endDate,
            // The first term of the active year becomes current, like the first year becomes active.
            isCurrent: year.isActive && !hasCurrent,
          },
        });
        return { after };
      },
    });
    revalidatePath(PATH, "layout");
    return { id: term.id };
  });
}

export async function updateTerm(id: unknown, input: unknown) {
  return runAction(["academicSettings", "update"], async (ctx) => {
    const termId = idSchema.parse(id);
    const data = termSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "Term",
      run: async (tx) => {
        const before = await must(tx.term.findFirst({ where: { id: termId, tenantId: audit.tenantId } }));
        const year = await must(tx.academicYear.findFirst({ where: { id: before.academicYearId, tenantId: audit.tenantId } }));
        const others = await tx.term.findMany({ where: { tenantId: audit.tenantId, academicYearId: year.id } });
        const issues = validateTerm({ ...data, id: before.id }, year, others);
        if (issues.length) await termError(issues);
        const after = await tx.term.update({
          where: { id: before.id },
          data: { name: data.name, startDate: data.startDate, endDate: data.endDate },
        });
        return { before, after };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

export async function deleteTerm(id: unknown) {
  return runAction(["academicSettings", "delete"], async (ctx) => {
    const termId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "Term",
      run: async (tx) => {
        const before = await must(tx.term.findFirst({ where: { id: termId, tenantId: audit.tenantId } }));
        // Scores belong to a term; the database refuses too (ON DELETE RESTRICT), this just says why.
        if ((await tx.assessment.count({ where: { tenantId: audit.tenantId, termId: before.id } })) > 0) {
          throw new InUseError(["assessments"]);
        }
        if ((await tx.reportCard.count({ where: { tenantId: audit.tenantId, termId: before.id } })) > 0) {
          throw new InUseError(["reportCards"]);
        }
        await tx.term.delete({ where: { id: before.id } });
        return { before, after: before };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

export async function setCurrentTerm(id: unknown) {
  return runAction(["academicSettings", "update"], async (ctx) => {
    const termId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    const t = await getTranslations("settings.terms.errors");
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "Term",
      run: async (tx) => {
        const before = await must(
          tx.term.findFirst({ where: { id: termId, tenantId: audit.tenantId }, include: { academicYear: { select: { isActive: true } } } }),
        );
        if (!before.academicYear.isActive) throw new UserFacingError(t("yearNotActive"));
        // Clear first: the partial unique index allows only one current term per school.
        await tx.term.updateMany({ where: { tenantId: audit.tenantId, isCurrent: true }, data: { isCurrent: false } });
        const after = await tx.term.update({ where: { id: before.id }, data: { isCurrent: true } });
        const { academicYear: _y, ...plain } = before;
        return { before: plain, after };
      },
    });
    revalidatePath(PATH, "layout");
    revalidatePath("/dashboard");
  });
}

/** One click for a new year: three terms with suggested dates, which the admin then adjusts. */
export async function addSuggestedTerms(academicYearId: unknown) {
  return runAction(["academicSettings", "create"], async (ctx) => {
    const yearId = idSchema.parse(academicYearId);
    const audit = auditContextFor(ctx);
    const t = await getTranslations("settings.terms");
    const names = [t("defaultNames.first"), t("defaultNames.second"), t("defaultNames.third")];
    await auditedMutation(audit, {
      action: "CREATE",
      entityType: "Term",
      run: async (tx) => {
        const year = await must(tx.academicYear.findFirst({ where: { id: yearId, tenantId: audit.tenantId } }));
        if ((await tx.term.count({ where: { tenantId: audit.tenantId, academicYearId: year.id } })) > 0) {
          throw new UserFacingError(t("errors.alreadyHasTerms"));
        }
        const hasCurrent = (await tx.term.count({ where: { tenantId: audit.tenantId, isCurrent: true } })) > 0;
        const suggested = suggestTerms(year, names);
        const current = year.isActive && !hasCurrent ? resolveCurrentTerm(suggested, new Date()) : null;
        const created = [];
        for (const [i, s] of suggested.entries()) {
          created.push(
            await tx.term.create({
              data: {
                tenantId: audit.tenantId,
                academicYearId: year.id,
                name: s.name,
                order: i + 1,
                startDate: s.startDate,
                endDate: s.endDate,
                isCurrent: s === current,
              },
            }),
          );
        }
        // One audit entry for the batch, keyed on the year.
        return { after: { id: year.id, terms: created } };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

// ---------------------------------------------------------------------------
// Grading scale
// ---------------------------------------------------------------------------

export async function saveGradeBands(input: unknown) {
  return runAction(["academicSettings", "update"], async (ctx) => {
    const { rows } = gradeBandsFormSchema.parse(input);
    const issues = validateGradeBands(rows);
    if (issues.length) {
      const t = await getTranslations("settings.grading.errors");
      const fieldErrors: Record<string, string> = {};
      for (const issue of issues) {
        if ("index" in issue) {
          const field = issue.code === "duplicateMin" || issue.code === "outOfRange" ? "minScore" : "grade";
          fieldErrors[`rows.${issue.index}.${field}`] ??= t(issue.code);
        }
      }
      throw new UserFacingError(t(issues[0]!.code), fieldErrors);
    }
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "GradingScale",
      run: async (tx) => {
        const before = await tx.gradeBand.findMany({ where: { tenantId: audit.tenantId }, orderBy: { minScore: "desc" } });
        await tx.gradeBand.deleteMany({ where: { tenantId: audit.tenantId } });
        await tx.gradeBand.createMany({
          data: rows.map((r) => ({ tenantId: audit.tenantId, minScore: r.minScore, grade: r.grade, remark: r.remark ?? null })),
        });
        const after = await tx.gradeBand.findMany({ where: { tenantId: audit.tenantId }, orderBy: { minScore: "desc" } });
        return { before: { id: audit.tenantId, bands: before }, after: { id: audit.tenantId, bands: after } };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

// ---------------------------------------------------------------------------
// Score components (assessment types)
// ---------------------------------------------------------------------------

export async function saveScoreComponents(input: unknown) {
  return runAction(["academicSettings", "update"], async (ctx) => {
    const { rows } = scoreComponentsFormSchema.parse(input);
    const t = await getTranslations("settings.scores.errors");
    const issues = validateScoreComponents(rows);
    if (issues.length) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of issues) {
        if ("index" in issue) fieldErrors[`rows.${issue.index}.${issue.code === "badWeight" ? "weight" : "name"}`] ??= t(issue.code);
      }
      const first = issues[0]!;
      throw new UserFacingError(first.code === "sumNot100" ? t("sumNot100", { sum: first.sum }) : t(first.code), fieldErrors);
    }
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "ScoreComponents",
      run: async (tx) => {
        const before = await tx.assessmentType.findMany({
          where: { tenantId: audit.tenantId },
          include: { _count: { select: { assessments: true } } },
          orderBy: [{ order: "asc" }, { name: "asc" }],
        });
        const byId = new Map(before.map((b) => [b.id, b]));
        for (const r of rows) if (r.id && !byId.has(r.id)) throw new NotFoundError();

        // Removing a component would cascade-delete its recorded scores — never do that silently.
        const keep = new Set(rows.map((r) => r.id).filter(Boolean));
        const removed = before.filter((b) => !keep.has(b.id));
        const inUse = removed.find((b) => b._count.assessments > 0);
        if (inUse) throw new UserFacingError(t("inUse", { name: inUse.name }));

        await applyComponents(tx, audit.tenantId, rows, removed.map((r) => r.id));
        const after = await tx.assessmentType.findMany({ where: { tenantId: audit.tenantId }, orderBy: { order: "asc" } });
        const plain = before.map(({ _count, ...b }) => b);
        return { before: { id: audit.tenantId, components: plain }, after: { id: audit.tenantId, components: after } };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

async function applyComponents(
  tx: PrismaClient,
  tenantId: string,
  rows: { id?: string; name: string; weight: number }[],
  removedIds: string[],
) {
  if (removedIds.length) await tx.assessmentType.deleteMany({ where: { tenantId, id: { in: removedIds } } });
  // Park renamed rows on temporary names first, so swapping two names
  // ("CA1" ↔ "CA2") doesn't trip the unique (tenant, name) index mid-way.
  const existing = rows.filter((r): r is typeof r & { id: string } => Boolean(r.id));
  for (const r of existing) await tx.assessmentType.update({ where: { id: r.id }, data: { name: `__tmp_${r.id}` } });
  for (const [order, r] of rows.entries()) {
    if (r.id) await tx.assessmentType.update({ where: { id: r.id }, data: { name: r.name, weight: r.weight, order } });
    else await tx.assessmentType.create({ data: { tenantId, name: r.name, weight: r.weight, order } });
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export async function saveAcademicOptions(input: unknown) {
  return runAction(["academicSettings", "update"], async (ctx) => {
    const data = academicOptionsSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "AcademicSettings",
      run: async (tx) => {
        const before = await tx.academicSettings.findUnique({ where: { tenantId: audit.tenantId } });
        const after = await tx.academicSettings.upsert({
          where: { tenantId: audit.tenantId },
          create: { tenantId: audit.tenantId, ...data },
          update: data,
        });
        return { before, after };
      },
    });
    revalidatePath(PATH, "layout");
  });
}
