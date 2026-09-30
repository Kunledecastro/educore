"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { recordAudit, Role, withRls } from "@educore/db";
import { ATTENDANCE_STATUSES, canEditRegister, diffRegister } from "@/lib/attendance";
import { attendanceEditDays, loadRegisterSection } from "@/lib/attendance-data";
import { todayInTimeZone } from "@/lib/format";
import { auditContextFor } from "@/lib/guard";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { getSettingsForUser } from "@/lib/tenant";
import { dateOnlySchema, idSchema } from "@/lib/validation/common";

const MAX_SECTION_SIZE = 300;

const registerSchema = z.object({
  sectionId: idSchema,
  date: dateOnlySchema,
  entries: z
    .array(
      z.object({
        studentId: idSchema,
        status: z.enum(ATTENDANCE_STATUSES),
        remark: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 200) || null : null), z.string().nullable()),
      }),
    )
    .max(MAX_SECTION_SIZE),
});

/**
 * Save a section's register for one day (milestone 2.1).
 *
 * Checks, in order: permission (runAction); the caller may take THIS
 * section's register (admin, or its form/subject teacher — else "not
 * found"); the section's year is the active one; the date is allowed
 * (not in the future, inside the year, within the teachers' edit window);
 * every student is enrolled in this section. Then only real changes are
 * written, each with its own audit entry (before/after), in one RLS
 * transaction — all or nothing.
 */
export async function saveRegister(input: unknown) {
  return runAction(["attendance", "update"], async (ctx) => {
    const data = registerSchema.parse(input);
    const t = await getTranslations("attendance.errors");
    const section = await loadRegisterSection(ctx, data.sectionId);
    const year = section.class.academicYear;
    if (!year.isActive) throw new UserFacingError(t("yearNotActive"));

    const settings = await getSettingsForUser(ctx.user.tenantId ?? null);
    const check = canEditRegister({
      date: data.date,
      today: todayInTimeZone(settings.timezone),
      isAdmin: ctx.user.role === Role.SCHOOL_ADMIN,
      editDays: await attendanceEditDays(ctx.db),
      year,
    });
    if (!check.allowed) throw new UserFacingError(t(check.reason));

    const ids = new Set<string>();
    for (const e of data.entries) {
      if (ids.has(e.studentId)) throw new UserFacingError(t("duplicateStudent"));
      ids.add(e.studentId);
    }

    const audit = auditContextFor(ctx);
    const result = await withRls(audit.tenantId, async (tx) => {
      const enrolled = await tx.student.findMany({
        where: { tenantId: audit.tenantId, sectionId: section.id, status: "ACTIVE", id: { in: [...ids] } },
        select: { id: true },
      });
      if (enrolled.length !== ids.size) throw new NotFoundError(); // someone not in this section (or another school)

      // A student has at most one entry per day (unique), whatever section it was taken in.
      const existing = await tx.attendance.findMany({
        where: { tenantId: audit.tenantId, date: data.date, studentId: { in: [...ids] } },
      });
      const byStudent = new Map(existing.map((e) => [e.studentId, e]));
      const changes = diffRegister(
        existing.map((e) => ({ studentId: e.studentId, status: e.status, remark: e.remarks })),
        data.entries,
      );

      for (const change of changes) {
        const { studentId, status, remark } = change.entry;
        if (change.kind === "create") {
          const after = await tx.attendance.create({
            data: {
              tenantId: audit.tenantId,
              studentId,
              classId: section.classId,
              sectionId: section.id,
              academicYearId: year.id,
              date: data.date,
              status,
              remarks: remark,
              markedById: ctx.user.id,
            },
          });
          await recordAudit(audit, { action: "CREATE", entityType: "Attendance", entityId: after.id, after }, tx);
        } else {
          const before = byStudent.get(studentId)!;
          const after = await tx.attendance.update({
            where: { id: before.id },
            data: { status, remarks: remark, markedById: ctx.user.id, sectionId: section.id, classId: section.classId },
          });
          await recordAudit(audit, { action: "UPDATE", entityType: "Attendance", entityId: after.id, before, after }, tx);
        }
      }
      return {
        created: changes.filter((c) => c.kind === "create").length,
        updated: changes.filter((c) => c.kind === "update").length,
      };
    });

    revalidatePath("/attendance", "layout");
    revalidatePath("/dashboard");
    return result;
  });
}
