import type { PrismaClient } from "@educore/db";
import { classSchema, sectionSchema } from "@/lib/validation/academics";
import type { ColumnDef } from "../csv";
import type { FieldIssue, ImportContext, Importer } from "../types";
import { norm, zodIssues } from "./shared";

/**
 * Classes and sections for one academic year: one row per class-section
 * (a class with no sections can have an empty `section`). Re-importing
 * updates order/capacity; names are matched case-insensitively.
 */

const COLUMNS: ColumnDef[] = [
  { key: "class", header: "class", aliases: ["class name", "grade"], required: true, example: "JSS 1" },
  { key: "section", header: "section", aliases: ["arm", "stream"], required: false, example: "A" },
  { key: "capacity", header: "capacity", aliases: ["max students"], required: false, example: "40" },
  { key: "order", header: "order", aliases: ["display order", "level"], required: false, example: "1" },
];

export interface ClassRow {
  academicYearId: string;
  className: string;
  order: number | null;
  sectionName: string | null;
  capacity: number | null;
}

async function loadLookup(_tx: PrismaClient, ctx: ImportContext) {
  if (!ctx.options.academicYearId) throw new Error("Class import needs an academic year");
  return { academicYearId: ctx.options.academicYearId };
}

function validate(r: Record<string, string>, lookup: { academicYearId: string }) {
  const issues: FieldIssue[] = [];
  const cls = classSchema.safeParse({ academicYearId: lookup.academicYearId, name: r.class ?? "", order: r.order ?? "" });
  if (!cls.success) issues.push(...zodIssues(cls.error, { name: "class", order: "order" }));
  let section: { name: string; capacity?: number } | null = null;
  if (r.section) {
    const s = sectionSchema.safeParse({ classId: "x", name: r.section, capacity: r.capacity ?? "" });
    if (!s.success) issues.push(...zodIssues(s.error, { name: "section", capacity: "capacity" }));
    else section = { name: s.data.name, capacity: s.data.capacity };
  } else if (r.capacity) {
    issues.push({ column: "capacity", message: "imports.issues.capacityWithoutSection" });
  }
  if (issues.length || !cls.success) return { issues };
  return {
    issues,
    row: {
      academicYearId: lookup.academicYearId,
      className: cls.data.name,
      order: r.order ? cls.data.order : null,
      sectionName: section?.name ?? null,
      capacity: section?.capacity ?? null,
    },
  };
}

async function apply(tx: PrismaClient, ctx: ImportContext, row: ClassRow) {
  const audits: { action: "CREATE" | "UPDATE"; entityType: string; entityId: string; before?: unknown; after: unknown }[] = [];
  const classes = await tx.classGrade.findMany({ where: { tenantId: ctx.tenantId, academicYearId: row.academicYearId } });
  let cls = classes.find((c) => norm(c.name) === norm(row.className));
  let outcome: "created" | "updated" = "updated";

  if (!cls) {
    cls = await tx.classGrade.create({
      data: { tenantId: ctx.tenantId, academicYearId: row.academicYearId, name: row.className, order: row.order ?? 0 },
    });
    audits.push({ action: "CREATE", entityType: "ClassGrade", entityId: cls.id, after: cls });
    outcome = "created";
  } else if (row.order !== null && row.order !== cls.order) {
    const after = await tx.classGrade.update({ where: { id: cls.id }, data: { order: row.order } });
    audits.push({ action: "UPDATE", entityType: "ClassGrade", entityId: cls.id, before: cls, after });
  }

  if (row.sectionName) {
    const sections = await tx.section.findMany({ where: { tenantId: ctx.tenantId, classId: cls.id } });
    const existing = sections.find((s) => norm(s.name) === norm(row.sectionName!));
    if (!existing) {
      const created = await tx.section.create({
        data: { tenantId: ctx.tenantId, classId: cls.id, name: row.sectionName, capacity: row.capacity },
      });
      audits.push({ action: "CREATE", entityType: "Section", entityId: created.id, after: created });
      outcome = "created";
    } else if (row.capacity !== null && row.capacity !== existing.capacity) {
      const after = await tx.section.update({ where: { id: existing.id }, data: { capacity: row.capacity } });
      audits.push({ action: "UPDATE", entityType: "Section", entityId: existing.id, before: existing, after });
    }
  }
  return { outcome, audits };
}

export const classesImporter: Importer<ClassRow, { academicYearId: string }> = {
  kind: "CLASSES",
  permission: ["classGrade", "create"],
  columns: COLUMNS,
  needsYear: true,
  loadLookup,
  validate,
  uniqueKeys: (row) => [{ key: `cls:${norm(row.className)}|${norm(row.sectionName ?? "")}`, column: row.sectionName ? "section" : "class" }],
  apply,
};
