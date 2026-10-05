import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange, ClipboardList } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { buttonVariants } from "@educore/ui/button";
import { Card, CardContent } from "@educore/ui/card";
import { EmptyState } from "@educore/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { gradebookPairsFor } from "@/lib/gradebook";
import { todayInTimeZone } from "@/lib/format";
import { requireModule } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { resolveTermRange } from "@/lib/term-range";
import { TermSwitcher } from "@/components/list/term-switcher";
import { ScoresTabs } from "./tabs";

export default async function GradebooksPage({ searchParams }: { searchParams: { term?: string | string[] } }) {
  const ctx = await requireModule("assessments");
  const { user, db } = ctx;
  if (ctx.isPlatformAdmin) redirect("/dashboard");
  if (user.role === Role.PARENT) redirect("/students");
  if (user.role === Role.STUDENT) redirect("/assessments/mine");
  if (user.role !== Role.SCHOOL_ADMIN && user.role !== Role.TEACHER) redirect("/dashboard");

  const t = await getTranslations("gradebook");
  const settings = await getSettingsForUser(user.tenantId ?? null);
  const year = await db.academicYear.findFirst({ where: { isActive: true } });
  if (!year) {
    return (
      <div>
        <PageHeader title={t("title")} />
        <EmptyState icon={<CalendarRange className="h-6 w-6" />} title={t("noYearTitle")} description={t("noYearDescription")} />
      </div>
    );
  }
  const range = await resolveTermRange(db, year, searchParams.term, todayInTimeZone(settings.timezone));
  const isAdmin = user.role === Role.SCHOOL_ADMIN;

  if (!range.term) {
    return (
      <div>
        <PageHeader title={t("title")} description={t("description")} />
        {isAdmin ? <ScoresTabs /> : null}
        <EmptyState
          icon={<CalendarRange className="h-6 w-6" />}
          title={t("noTermsTitle")}
          description={isAdmin ? t("noTermsAdmin") : t("noTermsTeacher")}
          action={
            isAdmin ? (
              <Link href="/settings" className={buttonVariants()}>
                {t("goToSettings")}
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  const [pairs, componentCount, assessments, publications] = await Promise.all([
    gradebookPairsFor(ctx, year.id),
    db.assessmentType.count(),
    db.assessment.findMany({
      where: { termId: range.term.id },
      select: { sectionId: true, subjectId: true, _count: { select: { marks: { where: { student: { status: "ACTIVE" } } } } } },
    }),
    db.resultPublication.findMany({ where: { termId: range.term.id }, select: { classId: true } }),
  ]);
  const sectionIds = [...new Set(pairs.map((p) => p.sectionId))];
  const studentCounts = await db.student.groupBy({
    by: ["sectionId"],
    where: { sectionId: { in: sectionIds }, status: "ACTIVE" },
    _count: { _all: true },
  });
  const studentsIn = new Map(studentCounts.map((s) => [s.sectionId, s._count._all]));
  const marksIn = new Map<string, number>();
  for (const a of assessments) {
    const key = `${a.sectionId}:${a.subjectId}`;
    marksIn.set(key, (marksIn.get(key) ?? 0) + a._count.marks);
  }
  const published = new Set(publications.map((p) => p.classId));

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      {isAdmin ? <ScoresTabs /> : null}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TermSwitcher terms={range.terms.map((x) => ({ id: x.id, name: x.name }))} selectedId={range.term.id} />
        {componentCount === 0 ? (
          <p className="text-sm text-destructive">
            {t("noComponents")}{" "}
            {isAdmin ? (
              <Link href="/settings/scores" className="underline">
                {t("setComponents")}
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>

      {pairs.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title={isAdmin ? t("noPairsAdmin") : t("noPairsTeacher")}
          description={isAdmin ? t("noPairsAdminHint") : t("noPairsTeacherHint")}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pairs.map((p) => {
            const students = studentsIn.get(p.sectionId) ?? 0;
            const expected = students * componentCount;
            const entered = marksIn.get(`${p.sectionId}:${p.subjectId}`) ?? 0;
            const pct = expected > 0 ? Math.min(100, Math.round((entered / expected) * 100)) : 0;
            const label = `${p.section.class.name} ${p.section.name} · ${p.subject.name}`;
            const isPublished = published.has(p.section.classId);
            return (
              <Card key={`${p.sectionId}:${p.subjectId}`}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-medium">{label}</h2>
                      <p className="text-xs text-muted-foreground">{p.teacher.user.name}</p>
                    </div>
                    {isPublished ? <Badge variant="success">{t("published")}</Badge> : null}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">{t("progress", { entered, expected })}</p>
                    <div
                      role="progressbar"
                      aria-label={t("progressLabel", { label })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    >
                      <div className={`h-full rounded-full ${pct === 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <Link
                    href={`/assessments/${p.sectionId}/${p.subjectId}?term=${range.term!.id}`}
                    className={buttonVariants({ size: "sm", variant: pct < 100 && !isPublished ? "default" : "outline" })}
                    aria-label={`${isPublished ? t("view") : t("open")}: ${label}`}
                  >
                    {isPublished ? t("view") : t("open")}
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
