import { recordAudit, type AuditContext, type PrismaClient } from "@educore/db";

/**
 * Publishing and unpublishing a class's results for a term. Used directly by
 * the results page and, when the school requires it (Phase 8.1), by the
 * approval engine on final approval — so both run the same checks.
 *
 * Publishing makes results visible to families and locks the scores.
 * Unpublishing hides them, unlocks the scores, and marks the class's
 * generated report cards for the term as needing regeneration.
 */

export class ResultsError extends Error {
  constructor(public readonly code: "notFound" | "alreadyPublished" | "notPublished") {
    super(code);
    this.name = "ResultsError";
  }
}

type Tx = PrismaClient;

/** The class and term, checked to belong to this school and to the same academic year. */
export async function resultsTarget(tx: Tx, tenantId: string, p: { classId: string; termId: string }) {
  const [cls, term] = await Promise.all([
    tx.classGrade.findFirst({ where: { id: p.classId, tenantId }, select: { id: true, name: true, academicYearId: true } }),
    tx.term.findFirst({ where: { id: p.termId, tenantId }, select: { id: true, name: true, academicYearId: true } }),
  ]);
  if (!cls || !term || term.academicYearId !== cls.academicYearId) throw new ResultsError("notFound");
  const publication = await tx.resultPublication.findFirst({ where: { tenantId, termId: term.id, classId: cls.id } });
  return { cls, term, publication };
}

export async function publishClassResults(tx: Tx, audit: AuditContext, p: { classId: string; termId: string }, opts: { idempotent?: boolean } = {}) {
  const { cls, term, publication } = await resultsTarget(tx, audit.tenantId, p);
  if (publication) {
    if (opts.idempotent) return publication; // the page: already published, nothing to do
    throw new ResultsError("alreadyPublished");
  }
  const after = await tx.resultPublication.create({ data: { tenantId: audit.tenantId, termId: term.id, classId: cls.id, publishedById: audit.actorId } });
  await recordAudit(audit, { action: "CREATE", entityType: "ResultPublication", entityId: after.id, before: null, after }, tx);
  return after;
}

export async function unpublishClassResults(tx: Tx, audit: AuditContext, p: { classId: string; termId: string; reason?: string; subjectIds?: string[] }) {
  const { cls, term, publication } = await resultsTarget(tx, audit.tenantId, p);
  if (!publication) throw new ResultsError("notPublished");
  await tx.resultPublication.delete({ where: { id: publication.id } });
  // Scores may now change, so the class's generated report cards are no
  // longer trustworthy: back to "not generated" until regenerated.
  await tx.reportCard.updateMany({ where: { tenantId: audit.tenantId, termId: term.id, student: { classId: cls.id }, status: "READY" }, data: { status: "PENDING" } });
  await recordAudit(audit, { action: "DELETE", entityType: "ResultPublication", entityId: publication.id, before: publication, after: { reason: p.reason ?? null, subjectIds: p.subjectIds ?? null } }, tx);
}
