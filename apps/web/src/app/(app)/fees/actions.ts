"use server";

import { revalidatePath } from "next/cache";
import { approvalGate, approvalUserError } from "@/lib/approvals/gate";
import { assignStudentDiscount, saveDiscountRule } from "@/lib/discount-writer";
import { getTranslations } from "next-intl/server";
import { auditedMutation, withRls, type Prisma, type PrismaClient } from "@educore/db";
import { fromMinor, parseScheduleCells, toMinor } from "@/lib/fees";
import { auditContextFor } from "@/lib/guard";
import { InUseError, NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";
import { copyScheduleSchema, discountSchema, feeItemSchema, scheduleSchema, signupsSchema, studentDiscountSchema } from "@/lib/validation/fees";

/**
 * Fee setup (milestone 3.0): fee items, the per-term schedule, discounts and
 * optional-item sign-ups. Same rules as every other action: permission first
 * (runAction → feeStructure), Zod-validated input, one RLS transaction with
 * its audit entry, and every id we're GIVEN is re-checked against this
 * school (FK checks ignore RLS).
 */

const PATH = "/fees";

async function must<T>(row: Promise<T | null>): Promise<T> {
  const found = await row;
  if (!found) throw new NotFoundError();
  return found;
}

/** A term that fees can still be set for. */
async function termOf(tx: PrismaClient, tenantId: string, termId: string) {
  return must(tx.term.findFirst({ where: { id: termId, tenantId }, select: { id: true, name: true, academicYearId: true } }));
}

// ---------------------------------------------------------------------------
// Fee items
// ---------------------------------------------------------------------------

export async function createFeeItem(input: unknown) {
  return runAction(["feeStructure", "create"], async (ctx) => {
    const data = feeItemSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "CREATE",
      entityType: "FeeType",
      run: async (tx) => {
        const last = await tx.feeType.aggregate({ where: { tenantId: audit.tenantId }, _max: { order: true } });
        const after = await tx.feeType.create({
          data: { tenantId: audit.tenantId, ...data, description: data.description ?? null, order: (last._max.order ?? 0) + 1 },
        });
        return { after };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

export async function updateFeeItem(id: unknown, input: unknown) {
  return runAction(["feeStructure", "update"], async (ctx) => {
    const itemId = idSchema.parse(id);
    const data = feeItemSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "FeeType",
      run: async (tx) => {
        const before = await must(tx.feeType.findFirst({ where: { id: itemId, tenantId: audit.tenantId } }));
        const after = await tx.feeType.update({ where: { id: before.id }, data: { ...data, description: data.description ?? null } });
        return { before, after };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

/** Moves an item up or down in the list (and on invoices). */
export async function moveFeeItem(id: unknown, direction: unknown) {
  return runAction(["feeStructure", "update"], async (ctx) => {
    const itemId = idSchema.parse(id);
    const dir = direction === "up" ? -1 : 1;
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "FeeType",
      run: async (tx) => {
        const all = await tx.feeType.findMany({ where: { tenantId: audit.tenantId }, orderBy: [{ order: "asc" }, { name: "asc" }] });
        const i = all.findIndex((x) => x.id === itemId);
        if (i < 0) throw new NotFoundError();
        const j = i + dir;
        if (j < 0 || j >= all.length) return { before: all[i]!, after: all[i]! };
        const reordered = [...all];
        [reordered[i], reordered[j]] = [reordered[j]!, reordered[i]!];
        for (const [n, item] of reordered.entries()) {
          if (item.order !== n + 1) await tx.feeType.update({ where: { id: item.id }, data: { order: n + 1 } });
        }
        return { before: { id: itemId, order: all[i]!.order }, after: { id: itemId, order: j + 1 } };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

export async function deleteFeeItem(id: unknown) {
  return runAction(["feeStructure", "delete"], async (ctx) => {
    const itemId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "FeeType",
      run: async (tx) => {
        const before = await must(tx.feeType.findFirst({ where: { id: itemId, tenantId: audit.tenantId } }));
        // Once billed, an item is history: deactivate it instead.
        const billed = await tx.invoiceLine.count({ where: { tenantId: audit.tenantId, feeStructure: { feeTypeId: before.id } } });
        if (billed > 0) throw new InUseError(["invoices"]);
        if ((await tx.discount.count({ where: { tenantId: audit.tenantId, feeTypeId: before.id } })) > 0) throw new InUseError(["discounts"]);
        await tx.feeStructure.deleteMany({ where: { tenantId: audit.tenantId, feeTypeId: before.id } });
        await tx.feeType.delete({ where: { id: before.id } });
        return { before, after: before };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

// ---------------------------------------------------------------------------
// Schedule: amount per item × class for a term
// ---------------------------------------------------------------------------

/**
 * Saves the whole grid for a term. Blank cells remove that charge. Cells
 * are matched to this school's items and to classes of the term's year;
 * anything else is refused. One audit entry with every changed cell.
 */
export async function saveSchedule(input: unknown) {
  return runAction(["feeStructure", "update"], async (ctx) => {
    const t = await getTranslations("fees.errors");
    const { termId, rows } = scheduleSchema.parse(input);
    const { issues, parsed } = parseScheduleCells(rows);
    if (issues.length) {
      const fieldErrors: Record<string, string> = {};
      for (const i of issues) fieldErrors[`rows.${i.index}.amount`] = t(i.code);
      throw new UserFacingError(t(issues[0]!.code), fieldErrors);
    }
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "FeeSchedule",
      run: async (tx) => {
        const term = await termOf(tx, audit.tenantId, termId);
        const [items, classes, existing] = await Promise.all([
          tx.feeType.findMany({ where: { tenantId: audit.tenantId }, select: { id: true } }),
          tx.classGrade.findMany({ where: { tenantId: audit.tenantId, academicYearId: term.academicYearId }, select: { id: true } }),
          tx.feeStructure.findMany({ where: { tenantId: audit.tenantId, termId: term.id } }),
        ]);
        const itemIds = new Set(items.map((i) => i.id));
        const classIds = new Set(classes.map((c) => c.id));
        if (parsed.some((c) => !itemIds.has(c.feeTypeId) || !classIds.has(c.classId))) throw new NotFoundError();

        const byKey = new Map(existing.map((e) => [`${e.feeTypeId}:${e.classId}`, e]));
        const changes: { item: string; class: string; from: string | null; to: string | null }[] = [];
        const creates: Prisma.FeeStructureCreateManyInput[] = [];
        for (const cell of parsed) {
          const key = `${cell.feeTypeId}:${cell.classId}`;
          const row = byKey.get(key);
          const was = row ? toMinor(row.amount) : null;
          if (cell.amountMinor === 0) {
            if (row) {
              // Lines already billed keep their own amount; they just lose the link.
              await tx.feeStructure.delete({ where: { id: row.id } });
              changes.push({ item: cell.feeTypeId, class: cell.classId, from: fromMinor(was ?? 0), to: null });
            }
          } else if (!row) {
            creates.push({
              tenantId: audit.tenantId,
              academicYearId: term.academicYearId,
              termId: term.id,
              classId: cell.classId,
              feeTypeId: cell.feeTypeId,
              amount: fromMinor(cell.amountMinor),
              frequency: "TERMLY" as const,
            });
            changes.push({ item: cell.feeTypeId, class: cell.classId, from: null, to: fromMinor(cell.amountMinor) });
          } else if (was !== cell.amountMinor) {
            await tx.feeStructure.update({ where: { id: row.id }, data: { amount: fromMinor(cell.amountMinor) } });
            changes.push({ item: cell.feeTypeId, class: cell.classId, from: fromMinor(was ?? 0), to: fromMinor(cell.amountMinor) });
          }
        }
        if (creates.length) await tx.feeStructure.createMany({ data: creates });
        return { before: { id: term.id, term: term.name }, after: { id: term.id, term: term.name, changes } };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

/**
 * Copies another term's schedule into this one, replacing it. Classes are
 * matched by name when the terms are in different years (next year's
 * "Grade 5" gets this year's "Grade 5" fees).
 */
export async function copySchedule(input: unknown) {
  return runAction(["feeStructure", "update"], async (ctx) => {
    const t = await getTranslations("fees.errors");
    const { fromTermId, toTermId } = copyScheduleSchema.parse(input);
    if (fromTermId === toTermId) throw new UserFacingError(t("sameTerm"));
    const audit = auditContextFor(ctx);
    const result = await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "FeeSchedule",
      run: async (tx) => {
        const from = await termOf(tx, audit.tenantId, fromTermId);
        const to = await termOf(tx, audit.tenantId, toTermId);
        const source = await tx.feeStructure.findMany({
          where: { tenantId: audit.tenantId, termId: from.id, classId: { not: null } },
          include: { class: { select: { name: true } } },
        });
        if (source.length === 0) throw new UserFacingError(t("nothingToCopy", { term: from.name }));
        const targetClasses = await tx.classGrade.findMany({ where: { tenantId: audit.tenantId, academicYearId: to.academicYearId }, select: { id: true, name: true } });
        const classByName = new Map(targetClasses.map((c) => [c.name.trim().toLowerCase(), c.id]));
        const before = await tx.feeStructure.findMany({ where: { tenantId: audit.tenantId, termId: to.id } });
        await tx.feeStructure.deleteMany({ where: { tenantId: audit.tenantId, termId: to.id } });
        const data: Prisma.FeeStructureCreateManyInput[] = [];
        for (const s of source) {
          const classId = from.academicYearId === to.academicYearId ? s.classId : classByName.get(s.class!.name.trim().toLowerCase());
          if (!classId) continue;
          data.push({ tenantId: audit.tenantId, academicYearId: to.academicYearId, termId: to.id, classId, feeTypeId: s.feeTypeId, amount: s.amount, frequency: "TERMLY" });
        }
        if (data.length) await tx.feeStructure.createMany({ data });
        const copied = data.length;
        return {
          before: { id: to.id, rows: before.map((b) => ({ item: b.feeTypeId, class: b.classId, amount: b.amount })) },
          after: { id: to.id, copiedFrom: from.id, rows: copied },
        };
      },
    });
    revalidatePath(PATH, "layout");
    return { copied: result.rows };
  });
}

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

export async function createDiscount(input: unknown) {
  return runAction(["feeStructure", "create"], async (ctx) => {
    const data = discountSchema.parse(input);
    const gate = await approvalGate(ctx, "DISCOUNT_RULE", { id: null, data }, "");
    if (gate) {
      revalidatePath("/approvals");
      return gate;
    }
    const audit = auditContextFor(ctx);
    await withRls(audit.tenantId, (tx) => saveDiscountRule(tx, audit, { id: null, data })).catch(async (err) => {
      throw await approvalUserError(err);
    });
    revalidatePath(PATH, "layout");
  });
}

export async function updateDiscount(id: unknown, input: unknown) {
  return runAction(["feeStructure", "update"], async (ctx) => {
    const discountId = idSchema.parse(id);
    const data = discountSchema.parse(input);
    const gate = await approvalGate(ctx, "DISCOUNT_RULE", { id: discountId, data }, "");
    if (gate) {
      revalidatePath("/approvals");
      return gate;
    }
    const audit = auditContextFor(ctx);
    // Invoices already issued keep the discount amount they were given; this only affects future bills.
    await withRls(audit.tenantId, (tx) => saveDiscountRule(tx, audit, { id: discountId, data })).catch(async (err) => {
      throw await approvalUserError(err);
    });
    revalidatePath(PATH, "layout");
  });
}

export async function deleteDiscount(id: unknown) {
  return runAction(["feeStructure", "delete"], async (ctx) => {
    const discountId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "Discount",
      run: async (tx) => {
        const before = await must(tx.discount.findFirst({ where: { id: discountId, tenantId: audit.tenantId } }));
        if ((await tx.studentDiscount.count({ where: { tenantId: audit.tenantId, discountId: before.id } })) > 0) {
          throw new InUseError(["studentDiscounts"]);
        }
        await tx.discount.delete({ where: { id: before.id } });
        return { before, after: before };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

export async function assignDiscount(input: unknown) {
  return runAction(["feeStructure", "update"], async (ctx) => {
    const data = studentDiscountSchema.parse(input);
    const gate = await approvalGate(ctx, "DISCOUNT_ASSIGN", data, data.note ?? "");
    if (gate) {
      revalidatePath(PATH, "layout");
      revalidatePath("/approvals");
      return gate;
    }
    const audit = auditContextFor(ctx);
    await withRls(audit.tenantId, (tx) => assignStudentDiscount(tx, audit, data)).catch(async (err) => {
      throw await approvalUserError(err);
    });
    revalidatePath(PATH, "layout");
  });
}

export async function removeStudentDiscount(id: unknown) {
  return runAction(["feeStructure", "update"], async (ctx) => {
    const sdId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "StudentDiscount",
      run: async (tx) => {
        const before = await must(tx.studentDiscount.findFirst({ where: { id: sdId, tenantId: audit.tenantId } }));
        await tx.studentDiscount.delete({ where: { id: before.id } });
        return { before, after: before };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

// ---------------------------------------------------------------------------
// Optional items: who's signed up, per section and term
// ---------------------------------------------------------------------------

export async function saveSignups(input: unknown) {
  return runAction(["feeStructure", "update"], async (ctx) => {
    const data = signupsSchema.parse(input);
    const t = await getTranslations("fees.errors");
    const audit = auditContextFor(ctx);
    const result = await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "FeeSignup",
      run: async (tx) => {
        const term = await termOf(tx, audit.tenantId, data.termId);
        const item = await must(tx.feeType.findFirst({ where: { id: data.feeTypeId, tenantId: audit.tenantId } }));
        if (!item.isOptional) throw new UserFacingError(t("notOptional", { item: item.name }));
        const section = await must(
          tx.section.findFirst({ where: { id: data.sectionId, tenantId: audit.tenantId, class: { academicYearId: term.academicYearId } }, select: { id: true } }),
        );
        const students = await tx.student.findMany({ where: { tenantId: audit.tenantId, sectionId: section.id, status: "ACTIVE" }, select: { id: true } });
        const inSection = new Set(students.map((s) => s.id));
        const wanted = new Set(data.studentIds);
        if ([...wanted].some((id) => !inSection.has(id))) throw new NotFoundError();

        const current = await tx.feeSignup.findMany({
          where: { tenantId: audit.tenantId, termId: term.id, feeTypeId: item.id, studentId: { in: [...inSection] } },
          select: { id: true, studentId: true },
        });
        const had = new Set(current.map((c) => c.studentId));
        const added = [...wanted].filter((id) => !had.has(id));
        const removed = current.filter((c) => !wanted.has(c.studentId));
        if (removed.length) await tx.feeSignup.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
        if (added.length) {
          await tx.feeSignup.createMany({ data: added.map((studentId) => ({ tenantId: audit.tenantId, studentId, feeTypeId: item.id, termId: term.id })) });
        }
        return {
          before: { id: `${term.id}:${item.id}:${section.id}`, signedUp: [...had] },
          after: { id: `${term.id}:${item.id}:${section.id}`, signedUp: [...wanted], added: added.length, removed: removed.length },
        };
      },
    });
    revalidatePath(PATH, "layout");
    return { added: result.added, removed: result.removed };
  });
}
