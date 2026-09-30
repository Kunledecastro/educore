import "server-only";
import { studentScopeWhere } from "@educore/auth";
import { Role, type Prisma } from "@educore/db";
import type { RequestContext } from "./guard";
import { teacherSectionIds } from "./teacher-sections";

/**
 * Row-level scope for student records (architecture rule #2: "Parents can
 * only access their own children's data"). AND this into every student
 * query. The permission matrix decides WHETHER a role may read students;
 * this decides WHICH students:
 *
 *   SCHOOL_ADMIN / ACCOUNTANT → the whole school (already tenant-scoped)
 *   TEACHER → students in sections they teach or are form teacher of
 *   PARENT  → only children linked to them as a guardian
 *   STUDENT → only themself
 *
 * Unknown/unlinked users get a filter that matches nothing, never everything.
 */
export async function studentScopeFor(ctx: RequestContext): Promise<Prisma.StudentWhereInput> {
  const { user, db } = ctx;
  switch (user.role) {
    case Role.PARENT: {
      const guardian = await db.guardian.findUnique({
        where: { userId: user.id },
        select: { students: { select: { studentId: true } } },
      });
      return studentScopeWhere(user, { guardianStudentIds: guardian?.students.map((s) => s.studentId) ?? [] });
    }
    case Role.TEACHER: {
      const { sectionIds } = await teacherSectionIds(db, user.id);
      return studentScopeWhere(user, { teacherSectionIds: sectionIds });
    }
    case Role.STUDENT: {
      const student = await db.student.findUnique({ where: { userId: user.id }, select: { id: true } });
      return studentScopeWhere(user, { ownStudentId: student?.id });
    }
    default:
      return studentScopeWhere(user, {});
  }
}
