import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange, FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { buttonVariants } from "@educore/ui/button";
import { Card, CardContent } from "@educore/ui/card";
import { EmptyState } from "@educore/ui/empty-state";
import { TermSwitcher } from "@/components/list/term-switcher";
import { PageHeader } from "@/components/page-header";
import { todayInTimeZone } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { cardState } from "@/lib/report-card";
import { reportCardSectionIdsFor } from "@/lib/report-card-data";
import { getSettingsForUser } from "@/lib/tenant";
import { resolveTermRange } from "@/lib/term-range";

export default async function ReportCardsPage({ searchParams }: { searchParams: { term?: string | string[] } }) {
  const ctx = await requireUser();
  const { user, db } = ctx;
  if (ctx.isPlatformAdmin) redirect("/dashboard");
  // Families download their child's card from the child's profile.
  if (user.role === Role.PARENT || user.role === Role.STUDENT) redirect("/students");
  if (user.role !== Role.SCHOOL_ADMIN && user.role !== Role.TEACHER) redirect("/dashboard");

  const t = await getTranslations("reportCards");
  const settings = await getSettingsForUser(user.tenantId ?? null);
  const isAdmin = user.role === Role.SCHOOL_ADMIN;
  const header = <PageHeader title={t("title")} description={t("description")} />;

  const year = await db.academicYear.findFirst({ where: { isActive: true } });
  if (!year) {
    return (
      <div>
        {header}
        <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noYearTitle")} description={t("noYearDescription")} />
      </div>
    );
  }
  const range = await resolveTermRange(db, year, searchParams.term, todayInTimeZone(settings.timezone));
  if (!range.term) {
    return (
      <div>
        {header}
        <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noTermsTitle")} description={t("noTermsHint")} />
      </div>
    );
  }
  const term = range.term;

  const allowed = await reportCardSectionIdsFor(ctx);
  const sections = await db.section.findMany({
    where: { class: { academicYearId: year.id }, ...(allowed === "all" ? {} : { id: { in: allowed } }) },
    orderBy: [{ class: { order: "asc" } }, { class: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      classId: true,
      class: { select: { name: true } },
      formTeacher: { select: { user: { select: { name: true } } } },
      students: { where: { status: "ACTIVE" }, select: { id: true } },
    },
  });
  const [cards, publications] = await Promise.all([
    db.reportCard.findMany({
      where: { termId: term.id, studentId: { in: sections.flatMap((s) => s.students.map((x) => x.id)) } },
      select: { studentId: true, teacherComment: true, status: true, generatedAt: true, updatedAt: true, snapshot: true },
    }),
    db.resultPublication.findMany({ where: { termId: term.id }, select: { classId: true } }),
  ]);
  const cardOf = new Map(cards.map((c) => [c.studentId, c]));
  const published = new Set(publications.map((p) => p.classId));

  return (
    <div>
      {header}
      <div className="mb-4">
        <TermSwitcher terms={range.terms.map((x) => ({ id: x.id, name: x.name }))} selectedId={term.id} />
      </div>
      {sections.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title={isAdmin ? t("noSectionsAdmin") : t("noSectionsTeacher")}
          description={isAdmin ? t("noSectionsAdminHint") : t("noSectionsTeacherHint")}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => {
            const total = s.students.length;
            const mine = s.students.map((x) => cardOf.get(x.id) ?? null);
            const comments = mine.filter((c) => c?.teacherComment).length;
            const states = mine.map((c) => cardState(c));
            const ready = states.filter((x) => x !== "notGenerated").length;
            const outdated = states.filter((x) => x === "outdated").length;
            const label = `${s.class.name} ${s.name}`;
            return (
              <Card key={s.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-medium">{label}</h2>
                      <p className="text-xs text-muted-foreground">
                        {s.formTeacher ? t("formTeacher", { name: s.formTeacher.user.name }) : t("noFormTeacher")}
                      </p>
                    </div>
                    {published.has(s.classId) ? (
                      <Badge variant="success">{t("resultsPublished")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("resultsNotPublished")}</Badge>
                    )}
                  </div>
                  <ul className="space-y-0.5 text-sm text-muted-foreground">
                    <li>{t("commentsProgress", { done: comments, total })}</li>
                    <li>{t("generatedProgress", { done: ready, total })}</li>
                    {outdated > 0 ? <li className="font-medium text-foreground">{t("outdatedCount", { count: outdated })}</li> : null}
                  </ul>
                  <Link
                    href={`/report-cards/${s.id}?term=${term.id}`}
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    aria-label={`${t("open")}: ${label}`}
                  >
                    {t("open")}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
