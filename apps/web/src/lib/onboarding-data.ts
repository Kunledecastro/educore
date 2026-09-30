import "server-only";
import { prisma, Role, type TenantScopedClient } from "@educore/db";
import { inviteIdentifier } from "./invite-token";
import { buildOnboardingChecklist, type OnboardingChecklist, type OnboardingFacts } from "./onboarding";

/** Staff roles whose sign-in the "invite" step tracks. Parents are deliberately excluded (see onboarding.ts). */
const STAFF_ROLES = [Role.SCHOOL_ADMIN, Role.TEACHER, Role.ACCOUNTANT] as const;

/**
 * Gathers the counts behind the checklist. Every query runs on the
 * tenant-scoped client, so it can only ever count this school's rows.
 * Invite tokens live in a platform table, so they're read with the base
 * client — but only for user ids that just came out of a tenant-scoped query.
 */
export async function loadOnboardingFacts(db: TenantScopedClient, viewerId: string): Promise<OnboardingFacts> {
  const activeYear = await db.academicYear.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  const yearId = activeYear?.id ?? "__none__";

  const [classCount, sectionCount, teacherCount, subjectCount, assignmentCount, studentCount, staffAccounts] = await Promise.all([
    db.classGrade.count({ where: { academicYearId: yearId } }),
    db.section.count({ where: { class: { academicYearId: yearId } } }),
    db.teacher.count({ where: { user: { isActive: true } } }),
    db.subject.count(),
    db.classSectionSubject.count({ where: { section: { class: { academicYearId: yearId } } } }),
    db.student.count({ where: { academicYearId: yearId, status: "ACTIVE" } }),
    db.user.findMany({
      where: { isActive: true, role: { in: [...STAFF_ROLES] }, id: { not: viewerId } },
      select: { id: true, passwordHash: true },
      take: 1000, // a school with more staff than this is well past onboarding
    }),
  ]);

  const needInvite = staffAccounts.filter((u) => !u.passwordHash);
  const liveInvites = needInvite.length
    ? await prisma.verificationToken.findMany({
        where: { identifier: { in: needInvite.map((u) => inviteIdentifier(u.id)) }, expires: { gt: new Date() } },
        select: { identifier: true },
        distinct: ["identifier"],
      })
    : [];

  return {
    activeYearName: activeYear?.name ?? null,
    classCount,
    sectionCount,
    teacherCount,
    subjectCount,
    assignmentCount,
    studentCount,
    staffAccountCount: staffAccounts.length,
    staffReadyCount: staffAccounts.length - needInvite.length + liveInvites.length,
  };
}

export async function loadOnboardingChecklist(db: TenantScopedClient, viewerId: string): Promise<OnboardingChecklist> {
  return buildOnboardingChecklist(await loadOnboardingFacts(db, viewerId));
}
