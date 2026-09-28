"use server";

import { revalidatePath } from "next/cache";
import { auditedMutation, type PrismaClient } from "@educore/db";
import { auditContextFor } from "@/lib/guard";
import { InUseError, NotFoundError, runAction } from "@/lib/run-action";
import {
  academicYearSchema,
  assignmentSchema,
  classSchema,
  deleteBlockers,
  sectionSchema,
  subjectSchema,
} from "@/lib/validation/academics";
import { idSchema } from "@/lib/validation/common";

/**
 * Academic setup actions (milestone 1.1). Every action:
 *   1. checks the permission matrix (runAction),
 *   2. validates input with the shared Zod schema,
 *   3. runs inside a tenant-bound RLS transaction with its audit entry
 *      (auditedMutation),
 *   4. re-checks that every id it was GIVEN belongs to this school.
 *
 * (4) matters because foreign-key checks in Postgres ignore RLS: without
 * it, a school admin who guessed another school's year id could attach a
 * class to it. Rows from other schools are invisible under RLS, so the
 * lookup returns null and we answer "not found".
 */

const PATH = "/academics";

async function must<T>(row: Promise<T | null>): Promise<T> {
  const found = await row;
  if (!found) throw new NotFoundError();
  return found;
}

function revalidate() {
  revalidatePath(PATH, "layout");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------- years ---

export async function createAcademicYear(input: unknown) {
  return runAction(["academicYear", "create"], async (ctx) => {
    const data = academicYearSchema.parse(input);
    const audit = auditContextFor(ctx);
    const year = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "AcademicYear",
      run: async (tx) => {
        // The school's first year becomes active automatically.
        const hasActive = (await tx.academicYear.count({ where: { tenantId: audit.tenantId, isActive: true } })) > 0;
        const after = await tx.academicYear.create({ data: { ...data, tenantId: audit.tenantId, isActive: !hasActive } });
        return { after };
      },
    });
    revalidate();
    return { id: year.id };
  });
}

export async function updateAcademicYear(id: unknown, input: unknown) {
  return runAction(["academicYear", "update"], async (ctx) => {
    const yearId = idSchema.parse(id);
    const data = academicYearSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "AcademicYear",
      run: async (tx) => {
        const before = await must(tx.academicYear.findFirst({ where: { id: yearId, tenantId: audit.tenantId } }));
        const after = await tx.academicYear.update({ where: { id: before.id }, data });
        return { before, after };
      },
    });
    revalidate();
  });
}

/** Makes this the school's active year; the previous one is deactivated in the same transaction. */
export async function setActiveAcademicYear(id: unknown) {
  return runAction(["academicYear", "update"], async (ctx) => {
    const yearId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "AcademicYear",
      run: async (tx) => {
        const before = await must(tx.academicYear.findFirst({ where: { id: yearId, tenantId: audit.tenantId } }));
        // Order matters: the partial unique index allows only one active year at a time.
        await tx.academicYear.updateMany({
          where: { tenantId: audit.tenantId, isActive: true, NOT: { id: before.id } },
          data: { isActive: false },
        });
        const after = await tx.academicYear.update({ where: { id: before.id }, data: { isActive: true } });
        return { before, after };
      },
    });
    revalidate();
  });
}

export async function deleteAcademicYear(id: unknown) {
  return runAction(["academicYear", "delete"], async (ctx) => {
    const yearId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "AcademicYear",
      run: async (tx) => {
        const before = await must(
          tx.academicYear.findFirst({
            where: { id: yearId, tenantId: audit.tenantId },
            include: {
              _count: {
                select: {
                  classes: true,
                  students: true,
                  attendance: true,
                  assessments: true,
                  reportCards: true,
                  feeStructures: true,
                  invoices: true,
                },
              },
            },
          }),
        );
        const blockers = deleteBlockers({ ...before._count, isActiveYear: before.isActive });
        if (blockers.length) throw new InUseError(blockers);
        const { _count, ...snapshot } = before;
        await tx.academicYear.delete({ where: { id: before.id } });
        return { before: snapshot, after: snapshot };
      },
    });
    revalidate();
  });
}

// -------------------------------------------------------------- classes ---

export async function createClass(input: unknown) {
  return runAction(["classGrade", "create"], async (ctx) => {
    const data = classSchema.parse(input);
    const audit = auditContextFor(ctx);
    const cls = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "ClassGrade",
      run: async (tx) => {
        await must(tx.academicYear.findFirst({ where: { id: data.academicYearId, tenantId: audit.tenantId } }));
        const after = await tx.classGrade.create({ data: { ...data, tenantId: audit.tenantId } });
        return { after };
      },
    });
    revalidate();
    return { id: cls.id };
  });
}

export async function updateClass(id: unknown, input: unknown) {
  return runAction(["classGrade", "update"], async (ctx) => {
    const classId = idSchema.parse(id);
    const data = classSchema.omit({ academicYearId: true }).parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "ClassGrade",
      run: async (tx) => {
        const before = await must(tx.classGrade.findFirst({ where: { id: classId, tenantId: audit.tenantId } }));
        const after = await tx.classGrade.update({ where: { id: before.id }, data });
        return { before, after };
      },
    });
    revalidate();
  });
}

/** Deletes a class and its (empty) sections and teacher assignments. Refused while it holds students or records. */
export async function deleteClass(id: unknown) {
  return runAction(["classGrade", "delete"], async (ctx) => {
    const classId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "ClassGrade",
      run: async (tx) => {
        const before = await must(
          tx.classGrade.findFirst({
            where: { id: classId, tenantId: audit.tenantId },
            include: { _count: { select: { students: true, feeStructures: true, timetableEntries: true } } },
          }),
        );
        const [attendance, assessments] = await Promise.all([
          tx.attendance.count({ where: { tenantId: audit.tenantId, section: { classId: before.id } } }),
          tx.assessment.count({ where: { tenantId: audit.tenantId, section: { classId: before.id } } }),
        ]);
        const blockers = deleteBlockers({
          students: before._count.students,
          feeStructures: before._count.feeStructures,
          timetable: before._count.timetableEntries,
          attendance,
          assessments,
        });
        if (blockers.length) throw new InUseError(blockers);
        const { _count, ...snapshot } = before;
        await tx.classGrade.delete({ where: { id: before.id } });
        return { before: snapshot, after: snapshot };
      },
    });
    revalidate();
  });
}

// ------------------------------------------------------------- sections ---

export async function createSection(input: unknown) {
  return runAction(["section", "create"], async (ctx) => {
    const data = sectionSchema.parse(input);
    const audit = auditContextFor(ctx);
    const section = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "Section",
      run: async (tx) => {
        await must(tx.classGrade.findFirst({ where: { id: data.classId, tenantId: audit.tenantId } }));
        const after = await tx.section.create({
          data: { classId: data.classId, name: data.name, capacity: data.capacity ?? null, tenantId: audit.tenantId },
        });
        return { after };
      },
    });
    revalidate();
    return { id: section.id };
  });
}

export async function updateSection(id: unknown, input: unknown) {
  return runAction(["section", "update"], async (ctx) => {
    const sectionId = idSchema.parse(id);
    const data = sectionSchema.omit({ classId: true }).parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "Section",
      run: async (tx) => {
        const before = await must(tx.section.findFirst({ where: { id: sectionId, tenantId: audit.tenantId } }));
        const after = await tx.section.update({
          where: { id: before.id },
          data: { name: data.name, capacity: data.capacity ?? null },
        });
        return { before, after };
      },
    });
    revalidate();
  });
}

export async function deleteSection(id: unknown) {
  return runAction(["section", "delete"], async (ctx) => {
    const sectionId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "Section",
      run: async (tx) => {
        const before = await must(
          tx.section.findFirst({
            where: { id: sectionId, tenantId: audit.tenantId },
            include: { _count: { select: { students: true, attendance: true, assessments: true, timetableEntries: true } } },
          }),
        );
        const blockers = deleteBlockers({
          students: before._count.students,
          attendance: before._count.attendance,
          assessments: before._count.assessments,
          timetable: before._count.timetableEntries,
        });
        if (blockers.length) throw new InUseError(blockers);
        const { _count, ...snapshot } = before;
        await tx.section.delete({ where: { id: before.id } });
        return { before: snapshot, after: snapshot };
      },
    });
    revalidate();
  });
}

// ------------------------------------------------------------- subjects ---

export async function createSubject(input: unknown) {
  return runAction(["subject", "create"], async (ctx) => {
    const data = subjectSchema.parse(input);
    const audit = auditContextFor(ctx);
    const subject = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "Subject",
      run: async (tx) => ({ after: await tx.subject.create({ data: { ...data, tenantId: audit.tenantId } }) }),
    });
    revalidate();
    return { id: subject.id };
  });
}

export async function updateSubject(id: unknown, input: unknown) {
  return runAction(["subject", "update"], async (ctx) => {
    const subjectId = idSchema.parse(id);
    const data = subjectSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "Subject",
      run: async (tx) => {
        const before = await must(tx.subject.findFirst({ where: { id: subjectId, tenantId: audit.tenantId } }));
        const after = await tx.subject.update({ where: { id: before.id }, data });
        return { before, after };
      },
    });
    revalidate();
  });
}

export async function deleteSubject(id: unknown) {
  return runAction(["subject", "delete"], async (ctx) => {
    const subjectId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "Subject",
      run: async (tx) => {
        const before = await must(
          tx.subject.findFirst({
            where: { id: subjectId, tenantId: audit.tenantId },
            include: { _count: { select: { assessments: true, timetableEntries: true } } },
          }),
        );
        const blockers = deleteBlockers({
          assessments: before._count.assessments,
          timetable: before._count.timetableEntries,
        });
        if (blockers.length) throw new InUseError(blockers);
        const { _count, ...snapshot } = before;
        await tx.subject.delete({ where: { id: before.id } });
        return { before: snapshot, after: snapshot };
      },
    });
    revalidate();
  });
}

// ------------------------------------------------- teacher assignments ---

async function assertAssignmentRefs(tx: PrismaClient, tenantId: string, refs: { sectionId: string; subjectId: string; teacherId: string }) {
  await Promise.all([
    must(tx.section.findFirst({ where: { id: refs.sectionId, tenantId } })),
    must(tx.subject.findFirst({ where: { id: refs.subjectId, tenantId } })),
    must(tx.teacher.findFirst({ where: { id: refs.teacherId, tenantId } })),
  ]);
}

export async function createAssignment(input: unknown) {
  return runAction(["teacherAssignment", "create"], async (ctx) => {
    const data = assignmentSchema.parse(input);
    const audit = auditContextFor(ctx);
    const row = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "ClassSectionSubject",
      run: async (tx) => {
        await assertAssignmentRefs(tx, audit.tenantId, data);
        return { after: await tx.classSectionSubject.create({ data: { ...data, tenantId: audit.tenantId } }) };
      },
    });
    revalidate();
    return { id: row.id };
  });
}

/** Hand a class-subject to a different teacher. */
export async function reassignTeacher(id: unknown, teacherId: unknown) {
  return runAction(["teacherAssignment", "update"], async (ctx) => {
    const assignmentId = idSchema.parse(id);
    const newTeacherId = idSchema.parse(teacherId);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "ClassSectionSubject",
      run: async (tx) => {
        const before = await must(tx.classSectionSubject.findFirst({ where: { id: assignmentId, tenantId: audit.tenantId } }));
        await must(tx.teacher.findFirst({ where: { id: newTeacherId, tenantId: audit.tenantId } }));
        const after = await tx.classSectionSubject.update({ where: { id: before.id }, data: { teacherId: newTeacherId } });
        return { before, after };
      },
    });
    revalidate();
  });
}

export async function deleteAssignment(id: unknown) {
  return runAction(["teacherAssignment", "delete"], async (ctx) => {
    const assignmentId = idSchema.parse(id);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "ClassSectionSubject",
      run: async (tx) => {
        const before = await must(tx.classSectionSubject.findFirst({ where: { id: assignmentId, tenantId: audit.tenantId } }));
        await tx.classSectionSubject.delete({ where: { id: before.id } });
        return { before, after: before };
      },
    });
    revalidate();
  });
}
