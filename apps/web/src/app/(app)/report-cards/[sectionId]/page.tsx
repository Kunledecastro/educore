import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, Download, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { buttonVariants } from "@educore/ui/button";
import { Card, CardContent } from "@educore/ui/card";
import { EmptyState } from "@educore/ui/empty-state";
import { TermSwitcher } from "@/components/list/term-switcher";
import { PageHeader } from "@/components/page-header";
import { loadClassResults } from "@/lib/class-results";
import { formatDateTime, formatNumber, todayInTimeZone } from "@/lib/format";
import { requireModule } from "@/lib/guard";
import { cardState } from "@/lib/report-card";
import { loadReportCardSection, STALE_RUN_MS } from "@/lib/report-card-data";
import { NotFoundError } from "@/lib/run-action";
import { getSettingsForUser } from "@/lib/tenant";
import { resolveTermRange } from "@/lib/term-range";
import { AutoRefresh } from "../../imports/[id]/report-controls";
import { CommentsEditor } from "./comments-editor";
import { GenerateButton } from "./generate-button";

export default async function SectionReportCardsPage({
  params,
  searchParams,
}: {
  params: { sectionId: string };
  searchParams: { term?: string | string[] };
}) {
  const ctx = await requireModule("reportCards");
  const { user, db } = ctx;
  if (ctx.isPlatformAdmin || (user.role !== Role.SCHOOL_ADMIN && user.role !== Role.TEACHER)) redirect("/report-cards");
  const section = await loadReportCardSection(ctx, params.sectionId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const [t, settings] = await Promise.all([getTranslations("reportCards"), getSettingsForUser(user.tenantId ?? null)]);
  const isAdmin = user.role === Role.SCHOOL_ADMIN;
  const year = section.class.academicYear;
  const range = await resolveTermRange(db, year, searchParams.term, todayInTimeZone(settings.timezone));
  const label = `${section.class.name} ${section.name}`;
  const back = (
    <Link href={`/report-cards${range.term ? `?term=${range.term.id}` : ""}`} className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-3 mb-2" })}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("backToAll")}
    </Link>
  );
  if (!range.term) {
    return (
      <div>
        {back}
        <PageHeader title={t("sectionTitle", { section: label })} />
        <EmptyState icon={<Users className="h-6 w-6" />} title={t("noTermsTitle")} description={t("noTermsHint")} />
      </div>
    );
  }
  const term = range.term;

  const students = await db.student.findMany({
    where: { sectionId: section.id, status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true, admissionNo: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const [cards, publication, lastRun, results] = await Promise.all([
    db.reportCard.findMany({ where: { termId: term.id, studentId: { in: students.map((s) => s.id) } } }),
    db.resultPublication.findFirst({ where: { termId: term.id, classId: section.classId } }),
    db.reportCardRun.findFirst({
      where: { termId: term.id, sectionId: section.id },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    }),
    loadClassResults(db, section.classId, term.id),
  ]);
  const cardOf = new Map(cards.map((c) => [c.studentId, c]));
  const averageOf = new Map(results.students.map((r) => [r.id, r.average]));
  const running = Boolean(lastRun && (lastRun.status === "QUEUED" || lastRun.status === "RUNNING") && Date.now() - lastRun.createdAt.getTime() < STALE_RUN_MS);
  const anyReady = cards.some((c) => cardState(c) !== "notGenerated");
  const pct = running && lastRun!.total > 0 ? Math.round((lastRun!.done / lastRun!.total) * 100) : 0;

  return (
    <div>
      <AutoRefresh active={running} />
      {back}
      <PageHeader
        title={t("sectionTitle", { section: label })}
        description={t("sectionDescription", { term: term.name, year: year.name })}
        actions={
          anyReady ? (
            <a href={`/api/report-cards/section?sectionId=${section.id}&term=${term.id}`} className={buttonVariants({ variant: "outline" })}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("downloadAll")}
            </a>
          ) : undefined
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <TermSwitcher terms={range.terms.map((x) => ({ id: x.id, name: x.name }))} selectedId={term.id} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{t("steps")}</p>

      <Card className="mb-6">
        <CardContent className="space-y-3 pt-6">
          {!publication ? (
            <p className="flex gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              {isAdmin ? t("needPublished", { term: term.name }) : t("needPublishedTeacher")}
            </p>
          ) : null}
          {running ? (
            <div className="space-y-2" aria-live="polite">
              <p className="text-sm font-medium">{t("running", { done: lastRun!.done, total: lastRun!.total })}</p>
              <div role="progressbar" aria-label={t("generate")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
              </div>
            </div>
          ) : lastRun?.status === "FAILED" ? (
            <p role="alert" className="text-sm text-destructive">{t("runFailed")}</p>
          ) : lastRun?.status === "COMPLETED" && lastRun.finishedAt ? (
            <p className="text-sm text-muted-foreground">
              {t("lastRun", { when: formatDateTime(lastRun.finishedAt, settings), name: lastRun.createdBy?.name ?? "—" })}
            </p>
          ) : null}
          {isAdmin ? (
            <GenerateButton
              sectionId={section.id}
              termId={term.id}
              label={label}
              regenerate={anyReady}
              disabled={!publication || running || students.length === 0}
            />
          ) : null}
        </CardContent>
      </Card>

      {students.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title={t("noStudents")} description="" />
      ) : (
        <CommentsEditor
          sectionId={section.id}
          termId={term.id}
          isAdmin={isAdmin}
          rows={students.map((s) => {
            const c = cardOf.get(s.id);
            const avg = averageOf.get(s.id) ?? null;
            return {
              studentId: s.id,
              name: `${s.lastName}, ${s.firstName}`,
              admissionNo: s.admissionNo,
              average: avg === null ? "—" : formatNumber(avg, settings),
              teacherComment: c?.teacherComment ?? "",
              principalComment: c?.principalComment ?? "",
              state: cardState(c ?? null),
              cardId: c?.id ?? null,
            };
          })}
        />
      )}
    </div>
  );
}
