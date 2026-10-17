import "server-only";
import { recordAudit, type AuditContext, type Role, type TenantScopedClient } from "@educore/db";
import type { AttendanceCounts } from "./attendance";
import type { Module } from "./entitlements";
import { roundScore } from "./grading";
import { alertsFor } from "./health/alerts";
import { healthConfigured, healthViewer } from "./health/data";
import type { AlertCategory, AlertSeverity } from "./health/rules";
import {
  ageOn,
  attendanceByTerm,
  feeRows,
  homeworkSummary,
  isFamily,
  profileSections,
  sectionForYear,
  type FeeRow,
  type HomeworkItem,
  type HomeworkSummary,
  type ProfileSection,
} from "./pupil-profile";
import { gradeForTotal, rank, studentAverage, subjectTotal } from "./results";
import { studentScopeFor } from "./student-scope";
import { parseTenantSettings, type TenantSettings } from "./tenant-settings";

/**
 * Pupil profile report (Phase 10.0), database side: everything the PDF
 * shows, read through the viewer's tenant-scoped client and the same row
 * scope as the pupil's page (a parent only reaches their own child, a
 * teacher only pupils in their sections). Returns null for anything the
 * viewer can't reach, so ids from another family or school reveal nothing.
 *
 * Built live at download time (unlike report cards, which are frozen).
 */

export interface ProfileViewer {
  user: { id: string; role: Role; tenantId: string | null; name: string; email: string };
  db: TenantScopedClient;
  isPlatformAdmin: boolean;
  impersonation: unknown;
}

export interface TermResult {
  termId: string;
  name: string;
  published: boolean;
  subjects: { name: string; total: number | null; complete: boolean; grade: string | null; remark: string | null }[];
  average: number | null;
  subjectCount: number;
  incomplete: number;
  /** Only when the school shows positions. */
  position: number | null;
  positionOutOf: number;
}

export interface ProfileYear {
  id: string;
  name: string;
  current: boolean;
  /** "JSS 1 A", from that year's own records (see sectionForYear). */
  className: string | null;
  attendance?: { terms: { termId: string; name: string; counts: AttendanceCounts }[]; year: AttendanceCounts };
  results?: TermResult[];
  homework?: { terms: { name: string; summary: HomeworkSummary }[]; year: HomeworkSummary };
}

export interface PupilProfile {
  school: { name: string; settings: TenantSettings };
  generatedAt: Date;
  generatedBy: string;
  /** Downloaded by a parent: results are published terms only, homework marks released ones only. */
  family: boolean;
  sections: ProfileSection[];
  pupil: {
    id: string;
    name: string;
    admissionNo: string;
    className: string | null;
    status: string;
    dateOfBirth: Date | null;
    age: number | null;
    gender: string | null;
    admissionDate: Date;
    leftAt: Date | null;
    formTeacher: string | null;
  };
  guardians?: { name: string; relationship: string; isPrimary: boolean; phone: string | null; email: string }[];
  years: ProfileYear[];
  fees?: { rows: FeeRow[]; total: Omit<FeeRow, "label">; currency: string };
  health?: { category: AlertCategory; severity: AlertSeverity; text: string }[];
}

/**
 * Every download goes in the school's audit log: who, which pupil, which
 * sections and years (not the contents).
 */
export async function recordProfileDownload(audit: AuditContext, profile: PupilProfile) {
  await recordAudit(audit, {
    action: "CREATE",
    entityType: "PupilProfileReport",
    entityId: profile.pupil.id,
    after: { pupil: profile.pupil.name, admissionNo: profile.pupil.admissionNo, sections: profile.sections, years: profile.years.map((y) => y.name) },
  });
}

const num = (v: { toString(): string } | number | null | undefined) => (v === null || v === undefined ? null : Number(v.toString()));

export async function loadPupilProfile(
  ctx: ProfileViewer,
  studentId: string,
  opts: { modules: ReadonlySet<Module>; now?: Date },
): Promise<PupilProfile | null> {
  const now = opts.now ?? new Date();
  const { db, user } = ctx;
  if (ctx.isPlatformAdmin || !user.tenantId) return null;
  const sections = profileSections(user.role, opts.modules, { impersonating: Boolean(ctx.impersonation) });
  if (sections.length === 0) return null;
  const has = (s: ProfileSection) => sections.includes(s);
  const family = isFamily(user.role);

  // Row scope first: nothing else is read for a pupil the viewer can't reach.
  const scope = await studentScopeFor(ctx as Parameters<typeof studentScopeFor>[0]);
  const student = await db.student.findFirst({
    where: { AND: [scope, { id: studentId }] },
    include: {
      class: { select: { name: true } },
      section: { select: { name: true, formTeacher: { select: { user: { select: { name: true } } } } } },
      academicYear: { select: { id: true } },
      guardians: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], include: { guardian: { select: { phone: true, user: { select: { name: true, email: true } } } } } },
    },
  });
  if (!student) return null;

  const tenant = await db.tenant.findFirst({ where: { id: user.tenantId }, select: { name: true, settings: true } });
  const settings = parseTenantSettings(tenant?.settings);

  // Every year the pupil left a trace in (registers, marks, homework, bills), plus their current year.
  const [attYears, markRows, subYears, invYears] = await Promise.all([
    db.attendance.findMany({ where: { studentId: student.id }, select: { academicYearId: true }, distinct: ["academicYearId"] }),
    db.mark.findMany({ where: { studentId: student.id }, select: { assessment: { select: { academicYearId: true } } } }),
    db.assignmentSubmission.findMany({ where: { studentId: student.id }, select: { assignment: { select: { academicYearId: true } } } }),
    has("fees") ? db.invoice.findMany({ where: { studentId: student.id }, select: { academicYearId: true }, distinct: ["academicYearId"] }) : Promise.resolve([]),
  ]);
  const yearIds = new Set<string>([
    ...attYears.map((a) => a.academicYearId),
    ...markRows.map((m) => m.assessment.academicYearId),
    ...subYears.map((s) => s.assignment.academicYearId),
    ...invYears.map((i) => i.academicYearId),
    ...(student.academicYearId ? [student.academicYearId] : []),
  ]);
  const yearRows = await db.academicYear.findMany({
    where: { id: { in: [...yearIds] } },
    orderBy: { startDate: "desc" },
    include: { terms: { orderBy: { order: "asc" } } },
  });

  const [showPosition, bands, components] = has("results")
    ? await Promise.all([
        db.academicSettings.findFirst({ select: { showPosition: true } }).then((s) => Boolean(s?.showPosition)),
        db.gradeBand.findMany({ orderBy: { minScore: "desc" } }),
        db.assessmentType.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] }),
      ])
    : [false, [], []];

  const years: ProfileYear[] = [];
  for (const y of yearRows) {
    const [attendance, myMarks] = await Promise.all([
      db.attendance.findMany({ where: { studentId: student.id, academicYearId: y.id }, select: { date: true, status: true, sectionId: true } }),
      db.mark.findMany({ where: { studentId: student.id, assessment: { academicYearId: y.id } }, select: { assessment: { select: { sectionId: true, termId: true } } } }),
    ]);
    const sectionId =
      y.id === student.academicYearId && student.sectionId
        ? student.sectionId
        : sectionForYear({ attendanceSectionIds: attendance.map((a) => a.sectionId), markSectionIds: myMarks.map((m) => m.assessment.sectionId) });
    const section = sectionId ? await db.section.findFirst({ where: { id: sectionId }, select: { id: true, name: true, classId: true, class: { select: { name: true } } } }) : null;

    const year: ProfileYear = {
      id: y.id,
      name: y.name,
      current: y.isActive,
      className: section ? `${section.class.name} ${section.name}` : null,
    };

    if (has("attendance") && attendance.length > 0) {
      year.attendance = attendanceByTerm(attendance, y.terms);
    }

    if (has("results")) {
      const results: TermResult[] = [];
      for (const term of y.terms) {
        // The section the pupil was marked in this term (normally the year's section).
        const termSection = myMarks.find((m) => m.assessment.termId === term.id)?.assessment.sectionId ?? null;
        if (!termSection) continue;
        const r = await termResult(db, { studentId: student.id, sectionId: termSection, term, components, bands, showPosition, family });
        if (r) results.push(r);
      }
      if (results.length) year.results = results;
    }

    if (has("homework") && section) {
      const list = await db.assignment.findMany({
        where: { academicYearId: y.id, sectionId: section.id, status: { not: "DRAFT" } },
        orderBy: { dueAt: "asc" },
        select: {
          dueAt: true,
          maxScore: true,
          marksReleasedAt: true,
          termId: true,
          submissions: { where: { studentId: student.id }, select: { status: true, isLate: true, isMissing: true, score: true } },
        },
      });
      if (list.length > 0) {
        const items = list.map((a) => {
          const s = a.submissions[0] ?? null;
          const item: HomeworkItem = {
            dueAt: a.dueAt,
            maxScore: num(a.maxScore),
            marksReleased: a.marksReleasedAt !== null,
            submission: s ? { status: s.status, isLate: s.isLate, isMissing: s.isMissing, score: num(s.score) } : null,
          };
          return { termId: a.termId, item };
        });
        const terms = y.terms
          .map((t) => ({ name: t.name, items: items.filter((i) => i.termId === t.id).map((i) => i.item) }))
          .filter((t) => t.items.length > 0)
          .map((t) => ({ name: t.name, summary: homeworkSummary(t.items, now, { family }) }));
        year.homework = { terms, year: homeworkSummary(items.map((i) => i.item), now, { family }) };
      }
    }
    years.push(year);
  }

  const profile: PupilProfile = {
    school: { name: tenant?.name ?? "", settings },
    generatedAt: now,
    generatedBy: user.name,
    family,
    sections,
    pupil: {
      id: student.id,
      name: `${student.firstName} ${student.lastName}`,
      admissionNo: student.admissionNo,
      className: student.class ? `${student.class.name}${student.section ? ` ${student.section.name}` : ""}` : null,
      status: student.status,
      dateOfBirth: student.dateOfBirth,
      age: student.dateOfBirth ? ageOn(student.dateOfBirth, now) : null,
      gender: student.gender?.toUpperCase() ?? null,
      admissionDate: student.admissionDate,
      leftAt: student.leftAt,
      formTeacher: student.section?.formTeacher?.user.name ?? null,
    },
    years,
  };

  if (has("guardians")) {
    profile.guardians = student.guardians.map((g) => ({
      name: g.guardian.user.name,
      relationship: g.relationship,
      isPrimary: g.isPrimary,
      phone: g.guardian.phone,
      email: g.guardian.user.email,
    }));
  }

  if (has("fees")) {
    const invoices = await db.invoice.findMany({
      where: { studentId: student.id },
      orderBy: [{ issueDate: "asc" }, { invoiceNo: "asc" }],
      select: { invoiceNo: true, status: true, subtotal: true, discountTotal: true, totalDue: true, amountPaid: true, currency: true, academicYear: { select: { name: true } }, term: { select: { name: true } } },
    });
    const f = feeRows(invoices.map((i) => ({ ...i, label: [i.academicYear.name, i.term?.name, i.invoiceNo].filter(Boolean).join(" · ") })));
    profile.fees = { ...f, currency: invoices[0]?.currency ?? settings.currency };
  }

  if (has("health")) {
    if (healthConfigured()) {
      const viewer = await healthViewer(user.tenantId, { id: user.id, role: user.role }, { impersonating: Boolean(ctx.impersonation) });
      const alerts = (await alertsFor(viewer, [student.id]))[student.id] ?? [];
      profile.health = alerts.map((a) => ({ category: a.category, severity: a.severity, text: a.text }));
    } else {
      profile.sections = profile.sections.filter((s) => s !== "health");
    }
  }

  return profile;
}

/**
 * One term's results for one pupil in the section they were marked in —
 * the same maths as class results (lib/results.ts). Families only get a
 * term once it's published for that class; staff see it marked "not
 * published". Subjects with no score at all are left out.
 */
async function termResult(
  db: TenantScopedClient,
  o: {
    studentId: string;
    sectionId: string;
    term: { id: string; name: string };
    components: { id: string; weight: number }[];
    bands: { minScore: number; grade: string; remark: string | null }[];
    showPosition: boolean;
    family: boolean;
  },
): Promise<TermResult | null> {
  const section = await db.section.findFirst({ where: { id: o.sectionId }, select: { classId: true } });
  if (!section) return null;
  const published = Boolean(await db.resultPublication.findFirst({ where: { termId: o.term.id, classId: section.classId }, select: { id: true } }));
  if (o.family && !published) return null;

  const [offered, assessments] = await Promise.all([
    db.classSectionSubject.findMany({ where: { sectionId: o.sectionId }, select: { subject: { select: { id: true, name: true } } } }),
    db.assessment.findMany({
      where: { termId: o.term.id, sectionId: o.sectionId },
      select: {
        subjectId: true,
        assessmentTypeId: true,
        maxScore: true,
        subject: { select: { id: true, name: true } },
        marks: { where: o.showPosition ? {} : { studentId: o.studentId }, select: { studentId: true, score: true } },
      },
    }),
  ]);
  const subjects = [...new Map([...offered.map((x) => x.subject), ...assessments.map((a) => a.subject)].map((s) => [s.id, s])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const byKey = new Map(assessments.map((a) => [`${a.subjectId}:${a.assessmentTypeId}`, a]));
  const score = new Map<string, number>();
  for (const a of assessments) for (const m of a.marks) score.set(`${a.subjectId}:${a.assessmentTypeId}:${m.studentId}`, m.score);

  const totalsFor = (studentId: string) =>
    subjects.map((s) => {
      const cells = o.components.map((c) => {
        const a = byKey.get(`${s.id}:${c.id}`);
        return { weight: c.weight, maxScore: a?.maxScore ?? c.weight, score: score.get(`${s.id}:${c.id}:${studentId}`) ?? null };
      });
      return { subject: s, total: subjectTotal(cells) };
    });

  const mine = totalsFor(o.studentId).filter((x) => x.total.scoredCount > 0);
  if (mine.length === 0) return null;
  const avg = studentAverage(mine.map((x) => x.total));

  let position: number | null = null;
  let positionOutOf = 0;
  if (o.showPosition) {
    // Everyone marked in this section and term, as at the time of the term.
    const peers = [...new Set(assessments.flatMap((a) => a.marks.map((m) => m.studentId)))];
    const averages = peers.map((id) => ({ key: id, value: studentAverage(totalsFor(id).map((x) => x.total)).average }));
    const positions = rank(averages);
    position = positions.get(o.studentId) ?? null;
    positionOutOf = averages.filter((a) => a.value !== null).length;
  }

  return {
    termId: o.term.id,
    name: o.term.name,
    published,
    subjects: mine.map((x) => {
      const g = gradeForTotal(x.total, o.bands);
      return { name: x.subject.name, total: x.total.total === null ? null : roundScore(x.total.total), complete: x.total.complete, grade: g?.grade ?? null, remark: g?.remark ?? null };
    }),
    average: avg.average,
    subjectCount: avg.subjects,
    incomplete: avg.incomplete,
    position,
    positionOutOf,
  };
}
