import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange, School } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { TermSwitcher } from "@/components/list/term-switcher";
import { loadClassResults } from "@/lib/class-results";
import { formatDateTime, formatNumber, todayInTimeZone } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { resolveTermRange } from "@/lib/term-range";
import { ScoresTabs } from "../tabs";
import { ClassSwitcher } from "./class-switcher";
import { PublishControls } from "./publish-controls";

export default async function ClassResultsPage({ searchParams }: { searchParams: { term?: string | string[]; class?: string | string[] } }) {
  const ctx = await requirePermission("results", "update", { page: true });
  const { user, db } = ctx;
  if (ctx.isPlatformAdmin || user.role !== Role.SCHOOL_ADMIN) redirect("/assessments");
  const [t, settings] = await Promise.all([getTranslations("gradebook"), getSettingsForUser(user.tenantId ?? null)]);

  const year = await db.academicYear.findFirst({ where: { isActive: true } });
  const header = (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ScoresTabs />
    </>
  );
  if (!year) {
    return (
      <div>
        {header}
        <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noYearTitle")} description={t("noYearDescription")} />
      </div>
    );
  }
  const range = await resolveTermRange(db, year, searchParams.term, todayInTimeZone(settings.timezone));
  const classes = await db.classGrade.findMany({ where: { academicYearId: year.id }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  if (!range.term || classes.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          icon={<School className="h-6 w-6" />}
          title={!range.term ? t("noTermsTitle") : t("noClasses")}
          description={!range.term ? t("noTermsAdmin") : t("noClassesHint")}
        />
      </div>
    );
  }
  const wanted = Array.isArray(searchParams.class) ? searchParams.class[0] : searchParams.class;
  const cls = classes.find((c) => c.id === wanted) ?? classes[0]!;
  const [results, publication, options] = await Promise.all([
    loadClassResults(db, cls.id, range.term.id),
    db.resultPublication.findFirst({ where: { termId: range.term.id, classId: cls.id }, include: { publishedBy: { select: { name: true } } } }),
    db.academicSettings.findFirst({ select: { showPosition: true } }),
  ]);
  const showPosition = options?.showPosition ?? false;
  const num = (n: number | null) => (n === null ? "—" : formatNumber(n, settings));

  return (
    <div>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <TermSwitcher terms={range.terms.map((x) => ({ id: x.id, name: x.name }))} selectedId={range.term.id} />
        <ClassSwitcher classes={classes} selectedId={cls.id} />
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-2 font-medium">
            {t("resultsFor", { class: cls.name, term: range.term.name })}
            {publication ? <Badge variant="success">{t("published")}</Badge> : <Badge variant="outline">{t("notPublished")}</Badge>}
          </p>
          <p className="text-muted-foreground">
            {publication
              ? t("publishedBy", { name: publication.publishedBy?.name ?? "—", when: formatDateTime(publication.publishedAt, settings) })
              : results.missingScores > 0
                ? t("missingScores", { count: results.missingScores })
                : t("allScoresIn")}
          </p>
        </div>
        <PublishControls
          classId={cls.id}
          termId={range.term.id}
          label={`${cls.name} · ${range.term.name}`}
          published={Boolean(publication)}
          missingScores={results.missingScores}
          disabled={results.students.length === 0}
        />
      </div>

      {results.students.length === 0 ? (
        <EmptyState icon={<School className="h-6 w-6" />} title={t("noStudents")} description={t("noStudentsHint")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">{t("resultsFor", { class: cls.name, term: range.term.name })}</caption>
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="sticky left-0 bg-muted/50 px-3 py-2 text-left font-medium">{t("student")}</th>
                {results.subjects.map((s) => (
                  <th key={s.id} scope="col" className="px-2 py-2 text-right font-medium" title={s.name}>
                    {s.code}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("average")}</th>
                {showPosition ? <th scope="col" className="px-3 py-2 text-right font-medium">{t("position")}</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {results.students.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="sticky left-0 bg-background px-3 py-1.5 text-left font-normal">
                    <Link href={`/students/${r.id}`} className="font-medium hover:underline">
                      {r.lastName}, {r.firstName}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {r.sectionName ? `${cls.name} ${r.sectionName} · ` : ""}
                      {r.admissionNo}
                    </span>
                  </th>
                  {results.subjects.map((s) => {
                    const x = r.subjects[s.id];
                    return (
                      <td key={s.id} className="px-2 py-1.5 text-right tabular-nums">
                        {!x ? (
                          <span className="text-muted-foreground" title={t("notTaken")}>·</span>
                        ) : x.total.total === null ? (
                          "—"
                        ) : (
                          <>
                            {num(x.total.total)}
                            <span className={`ml-1 text-xs ${x.total.complete ? "font-semibold" : "text-muted-foreground"}`}>
                              {x.total.complete ? (x.grade?.grade ?? "") : "*"}
                            </span>
                          </>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{num(r.average)}</td>
                  {showPosition ? (
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.position ? t("positionValue", { position: r.position, total: r.positionOutOf }) : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th scope="row" className="sticky left-0 bg-muted/30 px-3 py-1 text-left font-medium">{t("stats.average")}</th>
                {results.subjects.map((s) => (
                  <td key={s.id} className="px-2 py-1 text-right tabular-nums">{num(results.subjectStats[s.id]?.average ?? null)}</td>
                ))}
                <td />
                {showPosition ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t("resultsKey")}</p>
    </div>
  );
}
