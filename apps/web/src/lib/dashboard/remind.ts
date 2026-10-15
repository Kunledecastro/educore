import "server-only";
import { Prisma, recordAudit, withRls, type AuditContext } from "@educore/db";

/**
 * "Remind" on the admin dashboard (Phase 9.1): tell a form teacher their
 * register isn't taken yet. Once per section per day; recorded and audited.
 * The teacher sees it on their dashboard (and by email once email is set up).
 */

export class RemindError extends Error {
  constructor(public readonly code: "notFound" | "already" | "noFormTeacher") {
    super(code);
    this.name = "RemindError";
  }
}

export async function remindRegister(audit: AuditContext, sectionId: string, today: Date): Promise<{ teacher: { email: string; name: string } ; sectionName: string }> {
  try {
    return await withRls(audit.tenantId, async (tx) => {
      const section = await tx.section.findFirst({
        where: { id: sectionId, tenantId: audit.tenantId, class: { academicYear: { isActive: true } } },
        select: { id: true, name: true, class: { select: { name: true } }, formTeacher: { select: { user: { select: { email: true, name: true, isActive: true } } } } },
      });
      if (!section) throw new RemindError("notFound");
      const user = section.formTeacher?.user;
      if (!user || !user.isActive) throw new RemindError("noFormTeacher");
      const row = await tx.registerReminder.create({ data: { tenantId: audit.tenantId, sectionId: section.id, date: today, sentById: audit.actorId } });
      await recordAudit(audit, { action: "CREATE", entityType: "RegisterReminder", entityId: row.id, before: null, after: { sectionId: section.id, date: today.toISOString().slice(0, 10) } }, tx);
      return { teacher: { email: user.email, name: user.name ?? "" }, sectionName: `${section.class.name} ${section.name}` };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new RemindError("already");
    throw err;
  }
}
