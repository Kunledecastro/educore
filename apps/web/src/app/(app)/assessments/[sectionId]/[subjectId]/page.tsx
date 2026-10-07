import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarRange, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Role } from "@educore/db";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { TermSwitcher } from "@/components/list/term-switcher";
import { formatDateTime } from "@/lib/format";
import { loadGradebook } from "@/lib/gradebook";
import { requireModule } from "@/lib/guard";
import { NotFoundError } from "@/lib/run-action";
import { alertBadges } from "@/lib/health/page";
import { getSettingsForUser } from "@/lib/tenant";
import { GradebookGrid } from "./gradebook-grid";

export default async function GradebookPage({
  params,
  searchParams,
}: {
  params: { sectionId: string; subjectId: string };
  searchParams: { term?: string | string[] };
}) {
  const ctx = await requireModule("assessments");
  const { user } = ctx;
  if (ctx.isPlatformAdmin || !can(user.role, "mark", "update")) redirect("/assessments");
  const settings = await getSettingsForUser(user.tenantId ?? null);
  const book = await loadGradebook(ctx, params.sectionId, params.subjectId, searchParams.term, settings.timezone).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const [t, alerts] = await Promise.all([getTranslations("gradebook"), alertBadges(ctx, book.rows.map((r) => r.student.id))]);
  const label = `${book.section.class.name} ${book.section.name} · ${book.subject.name}`;
  const term = book.range.term;

  const back = (
    <Link href={`/assessments${term ? `?term=${term.id}` : ""}`} className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-3 mb-2" })}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("backToAll")}
    </Link>
  );
  if (!term) {
    return (
      <div>
        {back}
        <PageHeader title={label} />
        <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noTermsTitle")} description={t("noTermsTeacher")} />
      </div>
    );
  }

  const readOnlyReason = !book.year.isActive ? "yearNotActive" : book.publication ? "published" : book.components.length === 0 ? "noComponents" : null;
  const exportBase = `/api/exports/scores?sectionId=${book.section.id}&subjectId=${book.subject.id}&term=${term.id}`;

  return (
    <div>
      {back}
      <PageHeader
        title={label}
        description={t("gradebookDescription", { term: term.name, year: book.year.name })}
        actions={
          <>
            <a href={`${exportBase}&format=csv`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("exportCsv")}
            </a>
            <a href={`${exportBase}&format=xlsx`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("exportXlsx")}
            </a>
          </>
        }
      />
      <div className="mb-4">
        <TermSwitcher terms={book.range.terms.map((x) => ({ id: x.id, name: x.name }))} selectedId={term.id} />
      </div>
      {readOnlyReason ? (
        <p role="status" className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">
          {readOnlyReason === "published"
            ? t(user.role === Role.SCHOOL_ADMIN ? "lockedPublishedAdmin" : "lockedPublishedTeacher", {
                when: formatDateTime(book.publication!.publishedAt, settings),
              })
            : t(`locked.${readOnlyReason}`)}
        </p>
      ) : null}

      {book.rows.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title={t("noStudents")} description={t("noStudentsHint")} />
      ) : (
        <GradebookGrid
          key={term.id}
          sectionId={book.section.id}
          subjectId={book.subject.id}
          termId={term.id}
          readOnly={readOnlyReason !== null}
          components={book.components.map(({ id, name, weight, maxScore }) => ({ id, name, weight, maxScore }))}
          bands={book.bands.map((b) => ({ minScore: b.minScore, grade: b.grade, remark: b.remark }))}
          rows={book.rows.map((r) => ({
            id: r.student.id,
            name: `${r.student.lastName}, ${r.student.firstName}`,
            admissionNo: r.student.admissionNo,
            alerts: alerts[r.student.id],
            scores: r.scores,
          }))}
        />
      )}
    </div>
  );
}
