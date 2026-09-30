import { getTranslations } from "next-intl/server";
import { Role, type TenantScopedClient } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { loadClassResults } from "@/lib/class-results";
import { formatNumber, todayInTimeZone } from "@/lib/format";
import type { TenantSettings } from "@/lib/tenant-settings";
import { resolveCurrentTerm } from "@/lib/terms";

/**
 * A student's results for one term, on their profile (and the student's own
 * "My results"). Families (PARENT / STUDENT) only ever see a PUBLISHED term:
 * the most recent one published for the student's class. Staff see the
 * current term, marked "not published" while it isn't.
 */
export async function StudentResultsCard({
  db,
  student,
  yearId,
  viewerRole,
  settings,
}: {
  db: TenantScopedClient;
  student: { id: string; classId: string | null };
  yearId: string;
  viewerRole: Role;
  settings: TenantSettings;
}) {
  const t = await getTranslations("gradebook");
  const family = viewerRole === Role.PARENT || viewerRole === Role.STUDENT;
  const terms = await db.term.findMany({ where: { academicYearId: yearId }, orderBy: { order: "asc" } });
  const publications = student.classId
    ? await db.resultPublication.findMany({ where: { classId: student.classId, termId: { in: terms.map((x) => x.id) } }, select: { termId: true } })
    : [];
  const publishedIds = new Set(publications.map((p) => p.termId));
  const term = family
    ? [...terms].reverse().find((x) => publishedIds.has(x.id)) ?? null
    : resolveCurrentTerm(terms, todayInTimeZone(settings.timezone));

  const title = term ? t("profileTitle", { term: term.name }) : t("profileTitleNoTerm");
  if (!term || !student.classId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{family ? t("notYetPublished") : t("noTermsTitle")}</p>
        </CardContent>
      </Card>
    );
  }

  const [results, options] = await Promise.all([
    loadClassResults(db, student.classId, term.id, student.id),
    db.academicSettings.findFirst({ select: { showPosition: true } }),
  ]);
  const me = results.students[0];
  const isPublished = publishedIds.has(term.id);
  const num = (n: number | null) => (n === null ? "—" : formatNumber(n, settings));
  const taken = me ? results.subjects.filter((s) => me.subjects[s.id]) : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        {!family ? isPublished ? <Badge variant="success">{t("published")}</Badge> : <Badge variant="outline">{t("notPublished")}</Badge> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!me || taken.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noScoresYet")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-3xl font-semibold tabular-nums">{num(me.average)}</p>
                <p className="text-xs text-muted-foreground">{t("average")}</p>
              </div>
              {options?.showPosition && me.position ? (
                <div>
                  <p className="text-3xl font-semibold tabular-nums">{t("positionValue", { position: me.position, total: me.positionOutOf })}</p>
                  <p className="text-xs text-muted-foreground">{t("position")}</p>
                </div>
              ) : null}
            </div>
            <table className="w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 text-left font-medium">{t("subject")}</th>
                  <th scope="col" className="py-1 text-right font-medium">{t("total")}</th>
                  <th scope="col" className="py-1 pl-3 text-left font-medium">{t("grade")}</th>
                  <th scope="col" className="hidden py-1 text-right font-medium sm:table-cell">{t("classAverage")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {taken.map((s) => {
                  const x = me.subjects[s.id]!;
                  return (
                    <tr key={s.id}>
                      <th scope="row" className="py-1.5 text-left font-normal">{s.name}</th>
                      <td className="py-1.5 text-right tabular-nums">
                        {num(x.total.total)}
                        {x.total.total !== null && !x.total.complete ? <span className="text-muted-foreground">*</span> : null}
                      </td>
                      <td className="py-1.5 pl-3">
                        {x.grade ? (
                          <>
                            <span className="font-semibold">{x.grade.grade}</span>
                            {x.grade.remark ? <span className="ml-1 text-xs text-muted-foreground">{x.grade.remark}</span> : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden py-1.5 text-right tabular-nums text-muted-foreground sm:table-cell">
                        {num(results.subjectStats[s.id]?.average ?? null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {me.incomplete > 0 ? <p className="text-xs text-muted-foreground">{t("incompleteNote")}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
