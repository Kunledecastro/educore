/**
 * Report card contents (Phase 2, milestone 2.3). Pure and tested.
 *
 * At generation the background job freezes everything a card shows into a
 * versioned `snapshot` (stored on the ReportCard row). Every PDF — for a
 * parent today or a re-print next year — is drawn from that snapshot, so a
 * card never changes after it's generated, even if scores, comments, the
 * grading scale or the student's class change later. Regenerating makes a
 * new snapshot.
 */
import { z } from "zod";
import { bandRanges, type GradeBandInput } from "./grading";
import type { AttendanceCounts } from "./attendance";
import type { ClassResults, StudentResult } from "./class-results";

export const MAX_COMMENT_LENGTH = 600;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const score = z.number().finite().nullable();

export const snapshotSchema = z.object({
  v: z.literal(1),
  generatedAt: z.string(),
  school: z.object({ name: z.string(), locale: z.string(), dateStyle: z.enum(["short", "medium", "long"]) }),
  student: z.object({ name: z.string(), admissionNo: z.string(), className: z.string(), sectionName: z.string().nullable() }),
  period: z.object({ year: z.string(), term: z.string(), from: dateOnly, to: dateOnly, nextTermStarts: dateOnly.nullable() }),
  components: z.array(z.object({ name: z.string(), weight: z.number() })),
  subjects: z.array(
    z.object({
      name: z.string(),
      parts: z.array(score),
      total: score,
      complete: z.boolean(),
      grade: z.string().nullable(),
      remark: z.string().nullable(),
      classAverage: score,
    }),
  ),
  summary: z.object({
    average: score,
    subjects: z.number().int(),
    incomplete: z.number().int(),
    /** Null when the school doesn't show positions (decision 3) or there's no average. */
    position: z.number().int().nullable(),
    positionOutOf: z.number().int(),
  }),
  attendance: z.object({
    present: z.number().int(),
    absent: z.number().int(),
    late: z.number().int(),
    excused: z.number().int(),
    marked: z.number().int(),
    rate: score,
  }),
  comments: z.object({ teacher: z.string().nullable(), teacherName: z.string().nullable(), principal: z.string().nullable() }),
  gradingKey: z.array(z.object({ grade: z.string(), minScore: z.number(), maxScore: z.number(), remark: z.string().nullable() })),
});
export type ReportSnapshot = z.infer<typeof snapshotSchema>;

/** Reads a stored snapshot; anything malformed or from an unknown version → null (shown as "regenerate"). */
export function parseSnapshot(value: unknown): ReportSnapshot | null {
  const r = snapshotSchema.safeParse(value);
  return r.success ? r.data : null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim().slice(0, MAX_COMMENT_LENGTH) : null);

export interface SnapshotInput {
  now: Date;
  school: { name: string; locale: string; dateStyle: "short" | "medium" | "long" };
  className: string;
  year: { name: string };
  term: { name: string; startDate: Date; endDate: Date };
  nextTerm: { startDate: Date } | null;
  results: Pick<ClassResults, "subjects" | "components" | "subjectStats">;
  student: StudentResult;
  attendance: AttendanceCounts;
  bands: readonly GradeBandInput[];
  showPosition: boolean;
  comments: { teacher: string | null; teacherName: string | null; principal: string | null };
}

export function buildSnapshot(input: SnapshotInput): ReportSnapshot {
  const { student: s, results } = input;
  return {
    v: 1,
    generatedAt: input.now.toISOString(),
    school: input.school,
    student: { name: `${s.firstName} ${s.lastName}`, admissionNo: s.admissionNo, className: input.className, sectionName: s.sectionName },
    period: {
      year: input.year.name,
      term: input.term.name,
      from: iso(input.term.startDate),
      to: iso(input.term.endDate),
      nextTermStarts: input.nextTerm ? iso(input.nextTerm.startDate) : null,
    },
    components: results.components.map((c) => ({ name: c.name, weight: c.weight })),
    // Only subjects the student actually takes (taught in their section).
    subjects: results.subjects
      .filter((subj) => s.subjects[subj.id])
      .map((subj) => {
        const x = s.subjects[subj.id]!;
        return {
          name: subj.name,
          parts: x.parts,
          total: x.total.total,
          complete: x.total.complete,
          grade: x.grade?.grade ?? null,
          remark: x.grade?.remark ?? null,
          classAverage: results.subjectStats[subj.id]?.average ?? null,
        };
      }),
    summary: {
      average: s.average,
      subjects: s.subjectCount,
      incomplete: s.incomplete,
      position: input.showPosition && s.average !== null ? s.position : null,
      positionOutOf: s.positionOutOf,
    },
    attendance: {
      present: input.attendance.present,
      absent: input.attendance.absent,
      late: input.attendance.late,
      excused: input.attendance.excused,
      marked: input.attendance.marked,
      rate: input.attendance.rate,
    },
    comments: { teacher: clean(input.comments.teacher), teacherName: input.comments.teacherName, principal: clean(input.comments.principal) },
    gradingKey: bandRanges(input.bands).map((b) => ({ grade: b.grade, minScore: b.minScore, maxScore: b.maxScore, remark: b.remark ?? null })),
  };
}

export type CardState = "notGenerated" | "ready" | "outdated";

/**
 * A card is "outdated" when its comments changed after it was generated
 * (the row's updatedAt moves on every comment save). Score changes can't
 * happen after generation: generation needs published results, which lock
 * scores, and unpublishing marks the class's cards PENDING again.
 */
export function cardState(card: { status: string; generatedAt: Date | null; updatedAt: Date; snapshot: unknown } | null): CardState {
  if (!card || card.status !== "READY" || !card.generatedAt || !parseSnapshot(card.snapshot)) return "notGenerated";
  // 1s grace: generation itself writes updatedAt in the same statement.
  return card.updatedAt.getTime() - card.generatedAt.getTime() > 1000 ? "outdated" : "ready";
}
