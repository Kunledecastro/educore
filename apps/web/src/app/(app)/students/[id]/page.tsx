import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, HeartHandshake, Mail, Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Role } from "@educore/db";
import { Badge } from "@educore/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { AccountStatusBadge } from "@/components/people/account-status-badge";
import { PageHeader } from "@/components/page-header";
import { formatDateOnly } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { inviteStatusesFor } from "@/lib/invite-status";
import { studentScopeFor } from "@/lib/student-scope";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema, toDateInput } from "@/lib/validation/common";
import { classOptionsFor } from "../load-classes";
import { STATUS_BADGE } from "../status-badge";
import { EditStudentButton } from "../student-ui";
import { GuardianButtons, GuardianLinkActions, StudentStatusButton } from "./guardian-ui";

function ageOn(dob: Date, today = new Date()): number {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export default async function StudentProfilePage({ params }: { params: { id: string } }) {
  const ctx = await requirePermission("student", "read");
  const { db, user } = ctx;
  const id = idSchema.safeParse(params.id);
  if (!id.success) notFound();

  // Same row scope as the list: a parent opening another family's child gets a 404, not the record.
  const scope = await studentScopeFor(ctx);
  const student = await db.student.findFirst({
    where: { AND: [scope, { id: id.data }] },
    include: {
      class: { select: { name: true } },
      section: { select: { name: true } },
      academicYear: { select: { name: true } },
      guardians: {
        orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
        include: {
          guardian: {
            include: { user: { select: { id: true, name: true, email: true, isActive: true, passwordHash: true } } },
          },
        },
      },
    },
  });
  if (!student) notFound();

  const [t, tf, settings] = await Promise.all([
    getTranslations("students"),
    getTranslations("people.fields"),
    getSettingsForUser(user.tenantId ?? null),
  ]);
  const canManage = can(user.role, "student", "update") && user.role !== Role.PLATFORM_ADMIN;
  const canManageGuardians = can(user.role, "guardian", "update") && user.role !== Role.PLATFORM_ADMIN;
  const name = `${student.firstName} ${student.lastName}`;
  const classes = canManage && student.academicYearId ? await classOptionsFor(db, student.academicYearId) : [];
  const statuses = canManageGuardians ? await inviteStatusesFor(student.guardians.map((g) => g.guardian.user)) : new Map();
  const gender = student.gender?.toUpperCase();

  const details: [string, React.ReactNode][] = [
    [t("admissionNo"), <span key="a" className="font-mono">{student.admissionNo}</span>],
    [t("class"), `${student.class?.name ?? "—"}${student.section ? ` ${student.section.name}` : ""}${student.academicYear ? ` · ${student.academicYear.name}` : ""}`],
    [
      t("dateOfBirth"),
      student.dateOfBirth
        ? `${formatDateOnly(student.dateOfBirth, settings)} (${t("age", { age: ageOn(student.dateOfBirth) })})`
        : "—",
    ],
    [t("gender"), gender && ["FEMALE", "MALE", "OTHER"].includes(gender) ? t(`genders.${gender as "FEMALE" | "MALE" | "OTHER"}`) : "—"],
    [t("admissionDate"), formatDateOnly(student.admissionDate, settings)],
  ];

  return (
    <div className="space-y-6">
      <Link href="/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("backToList")}
      </Link>
      <PageHeader
        title={name}
        description={<Badge variant={STATUS_BADGE[student.status]}>{t(`statuses.${student.status}`)}</Badge>}
        actions={
          canManage ? (
            <>
              <EditStudentButton
                classes={classes}
                student={{
                  id: student.id,
                  admissionNo: student.admissionNo,
                  firstName: student.firstName,
                  lastName: student.lastName,
                  dateOfBirth: toDateInput(student.dateOfBirth),
                  gender: gender ?? "",
                  classId: student.classId ?? "",
                  sectionId: student.sectionId ?? "",
                  admissionDate: toDateInput(student.admissionDate),
                }}
              />
              <StudentStatusButton student={{ id: student.id, name, status: student.status }} />
            </>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("profile")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
              {details.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {/* Parents don't see the other guardians on file (e.g. separated families); staff do. */}
        {user.role === Role.PARENT ? null : (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <CardTitle className="text-base">{t("guardians")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {student.guardians.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <HeartHandshake className="h-4 w-4" aria-hidden="true" />
                {t("noGuardians")}
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {student.guardians.map((g) => {
                  const u = g.guardian.user;
                  return (
                    <li key={g.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{u.name}</span>
                          <span className="text-muted-foreground">· {t(`relationships.${g.relationship as "MOTHER" | "FATHER" | "GUARDIAN" | "OTHER"}`)}</span>
                          {g.isPrimary ? <Badge variant="secondary">{t("primary")}</Badge> : null}
                          {canManageGuardians ? <AccountStatusBadge status={statuses.get(u.id) ?? "notInvited"} /> : null}
                        </div>
                        {canManageGuardians || user.role === Role.TEACHER ? (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                              <span className="sr-only">{tf("email")}:</span>
                              {u.email}
                            </span>
                            {g.guardian.phone ? (
                              <a href={`tel:${g.guardian.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
                                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                                <span className="sr-only">{tf("phone")}:</span>
                                {g.guardian.phone}
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {canManageGuardians ? (
                        <GuardianLinkActions
                          studentName={name}
                          link={{ id: g.id, userId: u.id, name: u.name, isPrimary: g.isPrimary, status: statuses.get(u.id) ?? "notInvited" }}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {canManageGuardians ? <GuardianButtons studentId={student.id} hasGuardians={student.guardians.length > 0} /> : null}
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}
