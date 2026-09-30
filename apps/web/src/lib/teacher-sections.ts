import "server-only";
import type { TenantScopedClient } from "@educore/db";

/**
 * The sections a teacher works with: those they teach a subject in, plus
 * those they're form teacher of. Used for student visibility and for who
 * may take a section's register. Tenant-scoped client only.
 */
export async function teacherSectionIds(db: TenantScopedClient, userId: string): Promise<{ teacherId: string | null; sectionIds: string[]; formSectionIds: string[] }> {
  const teacher = await db.teacher.findUnique({
    where: { userId },
    select: {
      id: true,
      classSectionSubjects: { select: { sectionId: true } },
      formSections: { select: { id: true } },
    },
  });
  if (!teacher) return { teacherId: null, sectionIds: [], formSectionIds: [] };
  const formSectionIds = teacher.formSections.map((s) => s.id);
  const sectionIds = [...new Set([...teacher.classSectionSubjects.map((c) => c.sectionId), ...formSectionIds])];
  return { teacherId: teacher.id, sectionIds, formSectionIds };
}
