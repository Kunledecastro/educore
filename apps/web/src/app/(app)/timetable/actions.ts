"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { auditedMutation, Prisma, type PrismaClient } from "@educore/db";
import { auditContextFor } from "@/lib/guard";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { findClashes, numberPeriods, SCHOOL_DAYS, validatePeriods } from "@/lib/timetable";
import { idSchema } from "@/lib/validation/common";

const PATH = "/timetable";

const periodsSchema = z.object({
  rows: z
    .array(
      z.object({
        label: z.string().trim().max(20),
        startTime: z.string().trim(),
        endTime: z.string().trim(),
        isBreak: z.boolean(),
      }),
    )
    .max(16),
});
export type PeriodsInput = z.input<typeof periodsSchema>;

/**
 * Replace the school's bell schedule (admins). Periods are numbered in time
 * order. Refused if it would remove (or turn into a break) a period that
 * already has lessons — move those lessons first. Lesson start/end times
 * follow the new schedule. One audit entry with before/after.
 */
export async function savePeriods(input: unknown) {
  return runAction(["timetable", "update"], async (ctx) => {
    const t = await getTranslations("timetable.errors");
    const { rows } = periodsSchema.parse(input);
    const issues = validatePeriods(rows.map((r) => ({ ...r, number: 0 })));
    if (issues.length) {
      const first = issues[0]!;
      const fieldErrors: Record<string, string> = {};
      for (const i of issues) if ("index" in i) fieldErrors[`rows.${i.index}.${i.code === "blankLabel" ? "label" : "startTime"}`] ??= t(`periods.${i.code}`);
      throw new UserFacingError(t(`periods.${first.code}`), fieldErrors);
    }
    const numbered = numberPeriods(rows.map((r) => ({ ...r, number: 0 })));
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "BellSchedule",
      run: async (tx) => {
        const before = await tx.timetablePeriod.findMany({ where: { tenantId: audit.tenantId }, orderBy: { number: "asc" } });
        const teaching = new Set(numbered.filter((p) => !p.isBreak).map((p) => p.number));
        const used = await tx.timetableEntry.groupBy({ by: ["period"], where: { tenantId: audit.tenantId }, _count: { _all: true } });
        const orphaned = used.filter((u) => !teaching.has(u.period));
        if (orphaned.length) {
          throw new UserFacingError(t("periods.inUse", { count: orphaned.reduce((n, u) => n + u._count._all, 0) }));
        }
        await tx.timetablePeriod.deleteMany({ where: { tenantId: audit.tenantId } });
        await tx.timetablePeriod.createMany({ data: numbered.map((p) => ({ tenantId: audit.tenantId, ...p, label: p.label.trim() })) });
        for (const p of numbered.filter((x) => !x.isBreak)) {
          await tx.timetableEntry.updateMany({ where: { tenantId: audit.tenantId, period: p.number }, data: { startTime: p.startTime, endTime: p.endTime } });
        }
        return { before: { id: audit.tenantId, periods: before }, after: { id: audit.tenantId, periods: numbered } };
      },
    });
    revalidatePath(PATH, "layout");
  });
}

const slotSchema = z.object({
  sectionId: idSchema,
  dayOfWeek: z.number().int().refine((d) => (SCHOOL_DAYS as readonly number[]).includes(d)),
  period: z.number().int().min(1).max(16),
});
const lessonSchema = slotSchema.extend({
  /** The teacher assignment (section + subject + teacher) to place in the slot. */
  assignmentId: idSchema,
  room: z.preprocess((v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 40) || null : null), z.string().nullable()),
});

async function teachingPeriod(tx: PrismaClient, tenantId: string, number: number) {
  const p = await tx.timetablePeriod.findFirst({ where: { tenantId, number } });
  if (!p || p.isBreak) throw new NotFoundError();
  return p;
}

/**
 * Put a lesson in a section's slot (admins), replacing what was there.
 * The assignment must be this section's; the section must be in the active
 * year; the teacher and room must be free in that slot (checked here with
 * a clear message, and by database constraints against races). Audited.
 */
export async function saveLesson(input: unknown) {
  return runAction(["timetable", "update"], async (ctx) => {
    const t = await getTranslations("timetable.errors");
    const data = lessonSchema.parse(input);
    const audit = auditContextFor(ctx);
    try {
      await auditedMutation(audit, {
        action: "UPDATE",
        entityType: "TimetableEntry",
        run: async (tx) => {
          const section = await tx.section.findFirst({
            where: { id: data.sectionId, tenantId: audit.tenantId },
            include: { class: { select: { academicYearId: true, academicYear: { select: { isActive: true } } } } },
          });
          if (!section) throw new NotFoundError();
          if (!section.class.academicYear.isActive) throw new UserFacingError(t("yearNotActive"));
          const assignment = await tx.classSectionSubject.findFirst({
            where: { id: data.assignmentId, tenantId: audit.tenantId, sectionId: section.id },
            include: { subject: { select: { name: true } }, teacher: { select: { user: { select: { name: true } } } } },
          });
          if (!assignment) throw new NotFoundError();
          const period = await teachingPeriod(tx, audit.tenantId, data.period);

          const sameSlot = await tx.timetableEntry.findMany({
            where: { tenantId: audit.tenantId, academicYearId: section.class.academicYearId, dayOfWeek: data.dayOfWeek, period: data.period },
            include: { section: { select: { name: true, class: { select: { name: true } } } } },
          });
          const before = sameSlot.find((e) => e.sectionId === section.id) ?? null;
          const clash = findClashes(
            { id: before?.id, sectionId: section.id, teacherId: assignment.teacherId, room: data.room, dayOfWeek: data.dayOfWeek, period: data.period },
            sameSlot.map((e) => ({ id: e.id, sectionId: e.sectionId, teacherId: e.teacherId, room: e.room, dayOfWeek: e.dayOfWeek, period: e.period })),
          ).find((c) => c.kind !== "section");
          if (clash) {
            const other = sameSlot.find((e) => e.id === clash.with.id)!;
            const where = `${other.section.class.name} ${other.section.name}`;
            throw new UserFacingError(
              clash.kind === "teacher"
                ? t("teacherBusy", { teacher: assignment.teacher.user.name, section: where })
                : t("roomBusy", { room: data.room ?? "", section: where }),
            );
          }

          const fields = {
            classId: section.classId,
            subjectId: assignment.subjectId,
            teacherId: assignment.teacherId,
            academicYearId: section.class.academicYearId,
            startTime: period.startTime,
            endTime: period.endTime,
            room: data.room,
          };
          const after = before
            ? await tx.timetableEntry.update({ where: { id: before.id }, data: fields })
            : await tx.timetableEntry.create({
                data: { tenantId: audit.tenantId, sectionId: section.id, dayOfWeek: data.dayOfWeek, period: data.period, ...fields },
              });
          const { section: _s, ...plainBefore } = before ?? { section: null };
          return { before: before ? plainBefore : undefined, after };
        },
      });
    } catch (err) {
      // Someone else booked the teacher or room a moment ago: the database caught it.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new UserFacingError(t("justTaken"));
      throw err;
    }
    revalidatePath(PATH, "layout");
    revalidatePath("/dashboard");
  });
}

/** Empty a section's slot (admins). Audited. */
export async function clearLesson(input: unknown) {
  return runAction(["timetable", "delete"], async (ctx) => {
    const data = slotSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "DELETE",
      entityType: "TimetableEntry",
      run: async (tx) => {
        const before = await tx.timetableEntry.findFirst({
          where: { tenantId: audit.tenantId, sectionId: data.sectionId, dayOfWeek: data.dayOfWeek, period: data.period },
        });
        if (!before) throw new NotFoundError();
        await tx.timetableEntry.delete({ where: { id: before.id } });
        return { before, after: before };
      },
    });
    revalidatePath(PATH, "layout");
    revalidatePath("/dashboard");
  });
}
