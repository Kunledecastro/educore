import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { EmptyState } from "@educore/ui/empty-state";
import { ParamSelect } from "@/components/list/param-select";
import { PageHeader } from "@/components/page-header";
import { LoginRoster } from "@/components/students/login-roster";
import { LoginSettingsForm } from "@/components/students/login-settings";
import { formatDateOnly } from "@/lib/format";
import { auditContextFor, requirePermission } from "@/lib/guard";
import { getStudentLoginSettings, loginRoster } from "@/lib/student-logins-data";
import { getSettingsForUser } from "@/lib/tenant";
import { teacherSectionIds } from "@/lib/teacher-sections";

/**
 * Student logins (Phase 5.0). Admins switch logins on for chosen classes and
 * issue them; form teachers reset passwords for their own form sections.
 */
export default async function StudentLoginsPage({ searchParams }: { searchParams: { class?: string } }) {
  const ctx = await requirePermission("studentLogin", "read", { page: true });
  const { user, db } = ctx;
  const tenantId = user.tenantId!;
  const isAdmin = user.role === Role.SCHOOL_ADMIN;
  const [settings, t, tenant, schoolSettings] = await Promise.all([
    getStudentLoginSettings(tenantId),
    getTranslations("studentLogins"),
    db.tenant.findFirst({ where: { id: tenantId }, select: { name: true, slug: true } }),
    getSettingsForUser(tenantId),
  ]);

  const allClasses = await db.classGrade.findMany({ where: { academicYear: { isActive: true } }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  let classes = allClasses.filter((c) => settings.enabled && settings.classIds.includes(c.id));
  if (!isAdmin) {
    const { formSectionIds } = await teacherSectionIds(db, user.id);
    const formClassIds = new Set((await db.section.findMany({ where: { id: { in: formSectionIds } }, select: { classId: true } })).map((s) => s.classId));
    classes = classes.filter((c) => formClassIds.has(c.id));
  }
  const classId = classes.find((c) => c.id === searchParams.class)?.id ?? classes[0]?.id ?? null;
  const audit = auditContextFor(ctx);
  const actor = { userId: user.id, role: user.role, ipAddress: audit.ipAddress ?? null, userAgent: audit.userAgent ?? null };
  const rows = classId ? await loginRoster(tenantId, actor, classId) : [];
  const appUrl = (process.env.NEXTAUTH_URL && !process.env.NEXTAUTH_URL.includes("localhost") ? process.env.NEXTAUTH_URL : process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "").replace(/\/$/, "");
  const signInUrl = `${appUrl.replace(/^https?:\/\//, "")}/login?as=student`;

  return (
    <div className="space-y-6">
      <Link href="/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <PageHeader title={t("title")} description={t("description")} />

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <LoginSettingsForm classes={allClasses} initial={settings} />
          </CardContent>
        </Card>
      ) : null}

      {classes.length === 0 ? (
        <EmptyState icon={<KeyRound className="h-6 w-6" />} title={t("noneTitle")} description={isAdmin ? t("noneAdmin") : t("noneTeacher")} />
      ) : (
        <section aria-labelledby="roster" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="roster" className="text-lg font-semibold">
              {t("rosterTitle")}
            </h2>
            <ParamSelect param="class" label={t("class")} options={classes.map((c) => ({ value: c.id, label: c.name }))} selected={classId ?? ""} />
          </div>
          <p className="text-sm text-muted-foreground">{t("howItWorks", { school: tenant?.slug ?? "" })}</p>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptyClass")}</p>
          ) : (
            <LoginRoster
              rows={rows.map((r) => ({ studentId: r.studentId, name: r.name, admissionNo: r.admissionNo, section: r.section, state: r.state, consentAt: r.consentAt ? formatDateOnly(r.consentAt, schoolSettings) : null }))}
              canCreate={isAdmin}
              schoolName={tenant?.name ?? ""}
              signInUrl={signInUrl}
            />
          )}
        </section>
      )}
    </div>
  );
}
