/**
 * Results maths (Phase 2, milestone 2.2). Pure and heavily tested: every
 * screen, export and (in 2.3) report card gets totals, grades, averages
 * and positions from here — never from its own arithmetic.
 *
 * Model (decision 2): a subject's term total is the sum of the school's
 * score components, which add up to 100. Each component is one assessment
 * scored out of its own `maxScore`; its contribution is
 * score ÷ maxScore × component weight. So a test marked out of 50 for a
 * 20-mark component contributes score × 20/50.
 */
import { gradeFor, roundScore, type GradeBandInput } from "./grading";

export interface ComponentCell {
  /** Component weight: marks out of the subject's 100. */
  weight: number;
  /** What the assessment is marked out of (defaults to the weight). */
  maxScore: number;
  score: number | null;
}

/** One component's share of the 100, unrounded. Null when not scored. */
export function contribution(cell: ComponentCell): number | null {
  if (cell.score === null || !Number.isFinite(cell.score) || cell.maxScore <= 0) return null;
  return (cell.score / cell.maxScore) * cell.weight;
}

export interface SubjectTotal {
  /** Sum of scored components, rounded to 1 d.p. Null when nothing is scored. */
  total: number | null;
  /** Every component has a score. Only complete totals get a grade or count toward averages. */
  complete: boolean;
  scoredCount: number;
}

export function subjectTotal(cells: readonly ComponentCell[]): SubjectTotal {
  let sum = 0;
  let scoredCount = 0;
  for (const c of cells) {
    const part = contribution(c);
    if (part !== null) {
      sum += part;
      scoredCount++;
    }
  }
  return {
    total: scoredCount === 0 ? null : roundScore(sum),
    complete: cells.length > 0 && scoredCount === cells.length,
    scoredCount,
  };
}

/** Grade and remark for a subject total — only for a complete total, so a missing exam never shows as an F. */
export function gradeForTotal<T extends GradeBandInput>(t: SubjectTotal, bands: readonly T[]): T | null {
  return t.complete ? gradeFor(t.total, bands) : null;
}

/** Is `score` valid for an assessment marked out of `maxScore`? Up to 2 decimal places. */
export function isValidScore(score: number, maxScore: number): boolean {
  return Number.isFinite(score) && score >= 0 && score <= maxScore && Math.abs(score * 100 - Math.round(score * 100)) < 1e-9;
}

export interface Stats {
  count: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
}

/** Class statistics over the values present (nulls ignored). Average rounded to 1 d.p. */
export function stats(values: readonly (number | null | undefined)[]): Stats {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return { count: 0, average: null, highest: null, lowest: null };
  return {
    count: nums.length,
    average: roundScore(nums.reduce((a, b) => a + b, 0) / nums.length),
    highest: Math.max(...nums),
    lowest: Math.min(...nums),
  };
}

/**
 * Positions with ties shared ("standard competition" ranking: 1, 2, 2, 4).
 * Higher is better. Entries with no value get no position.
 * Values are compared after rounding to 1 d.p., the precision people see —
 * two students both shown as 72.4 share a position.
 */
export function rank<K>(entries: readonly { key: K; value: number | null }[]): Map<K, number> {
  const scored = entries
    .filter((e): e is { key: K; value: number } => e.value !== null && Number.isFinite(e.value))
    .map((e) => ({ key: e.key, value: roundScore(e.value) }))
    .sort((a, b) => b.value - a.value);
  const positions = new Map<K, number>();
  scored.forEach((e, i) => {
    const prev = scored[i - 1];
    positions.set(e.key, prev && prev.value === e.value ? positions.get(prev.key)! : i + 1);
  });
  return positions;
}

/**
 * A student's term average: the mean of their COMPLETE subject totals
 * (1 d.p.). Incomplete subjects are left out and reported, so an admin can
 * see who is missing scores before publishing.
 */
export function studentAverage(totals: readonly SubjectTotal[]): { average: number | null; subjects: number; incomplete: number } {
  const complete = totals.filter((t) => t.complete && t.total !== null);
  const incomplete = totals.filter((t) => !t.complete && t.scoredCount > 0).length;
  if (complete.length === 0) return { average: null, subjects: 0, incomplete };
  const sum = complete.reduce((a, t) => a + (t.total as number), 0);
  return { average: roundScore(sum / complete.length), subjects: complete.length, incomplete };
}
