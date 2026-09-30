/**
 * Grading maths (Phase 2). Results are high-stakes, so everything that
 * decides a total or a grade lives here as pure functions with tests —
 * screens, report cards and exports all call these, never their own copy.
 *
 * Model (confirmed decision 2): a subject's term total is the sum of the
 * school's score components (e.g. CA1 20 + CA2 20 + Exam 60), which add up
 * to 100. The grade comes from the school's grading scale: a list of bands,
 * each "from minScore up to the next band".
 */

export interface GradeBandInput {
  minScore: number;
  grade: string;
  remark?: string | null;
}

export interface ScoreComponentInput {
  name: string;
  weight: number;
}

/** A starting scale a school can adopt with one click, then edit. Common in Nigerian primary/secondary schools. */
export const DEFAULT_GRADE_BANDS: readonly GradeBandInput[] = [
  { minScore: 70, grade: "A", remark: "Excellent" },
  { minScore: 60, grade: "B", remark: "Very good" },
  { minScore: 50, grade: "C", remark: "Good" },
  { minScore: 45, grade: "D", remark: "Fair" },
  { minScore: 40, grade: "E", remark: "Pass" },
  { minScore: 0, grade: "F", remark: "Fail" },
];

/** Starting score components (decision 2 example). */
export const DEFAULT_SCORE_COMPONENTS: readonly ScoreComponentInput[] = [
  { name: "CA1", weight: 20 },
  { name: "CA2", weight: 20 },
  { name: "Exam", weight: 60 },
];

/** Round half away from zero to `decimals` places, without binary-float surprises (e.g. 69.95 → 70.0). */
export function roundScore(value: number, decimals = 1): number {
  if (!Number.isFinite(value)) return value;
  // Shift the decimal point in the string form ("69.95e1" = 699.5) so the
  // rounding sees the decimal value the person typed, not its binary approximation.
  const shifted = Math.round(Number(`${Math.abs(value)}e${decimals}`));
  return Math.sign(value) * Number(`${shifted}e-${decimals}`);
}

/** Bands sorted highest first — the order `gradeFor` needs. */
export function sortBands<T extends GradeBandInput>(bands: readonly T[]): T[] {
  return [...bands].sort((a, b) => b.minScore - a.minScore);
}

/**
 * The band a total falls in. The total is rounded first (1 decimal place),
 * so a displayed 69.95 → 70.0 gets the grade a reader would expect.
 * Returns null for a missing score or an unusable scale.
 */
export function gradeFor<T extends GradeBandInput>(total: number | null | undefined, bands: readonly T[]): T | null {
  if (total === null || total === undefined || !Number.isFinite(total)) return null;
  const rounded = roundScore(total);
  return sortBands(bands).find((b) => rounded >= b.minScore) ?? null;
}

export type ScaleIssue =
  | { code: "empty" }
  | { code: "noZeroBand" }
  | { code: "outOfRange"; index: number }
  | { code: "duplicateMin"; index: number }
  | { code: "duplicateGrade"; index: number }
  | { code: "blankGrade"; index: number };

/**
 * A usable scale: at least one band, every score 0–100 covered (a band
 * starting at 0), no two bands with the same minimum or the same grade.
 * `index` points at the offending row as the admin entered it.
 */
export function validateGradeBands(bands: readonly GradeBandInput[]): ScaleIssue[] {
  const issues: ScaleIssue[] = [];
  if (bands.length === 0) return [{ code: "empty" }];
  const seenMin = new Set<number>();
  const seenGrade = new Set<string>();
  bands.forEach((b, index) => {
    const grade = b.grade.trim();
    if (!grade) issues.push({ code: "blankGrade", index });
    if (!Number.isFinite(b.minScore) || b.minScore < 0 || b.minScore > 100) issues.push({ code: "outOfRange", index });
    if (seenMin.has(b.minScore)) issues.push({ code: "duplicateMin", index });
    const key = grade.toLowerCase();
    if (grade && seenGrade.has(key)) issues.push({ code: "duplicateGrade", index });
    seenMin.add(b.minScore);
    if (grade) seenGrade.add(key);
  });
  if (!bands.some((b) => b.minScore === 0)) issues.push({ code: "noZeroBand" });
  return issues;
}

/** "70–100", "60–69.9" … for display. Upper bound = next band's minimum minus one step (0.1). */
export function bandRanges<T extends GradeBandInput>(bands: readonly T[]): (T & { maxScore: number })[] {
  const sorted = sortBands(bands);
  return sorted.map((b, i) => ({ ...b, maxScore: i === 0 ? 100 : roundScore(sorted[i - 1]!.minScore - 0.1) }));
}

export type ComponentIssue =
  | { code: "empty" }
  | { code: "sumNot100"; sum: number }
  | { code: "badWeight"; index: number }
  | { code: "duplicateName"; index: number }
  | { code: "blankName"; index: number };

/** Components must each be worth more than 0 and add up to exactly 100 (to 1 decimal place). */
export function validateScoreComponents(components: readonly ScoreComponentInput[]): ComponentIssue[] {
  const issues: ComponentIssue[] = [];
  if (components.length === 0) return [{ code: "empty" }];
  const seen = new Set<string>();
  components.forEach((c, index) => {
    const name = c.name.trim();
    if (!name) issues.push({ code: "blankName", index });
    if (!Number.isFinite(c.weight) || c.weight <= 0 || c.weight > 100) issues.push({ code: "badWeight", index });
    const key = name.toLowerCase();
    if (name && seen.has(key)) issues.push({ code: "duplicateName", index });
    if (name) seen.add(key);
  });
  const sum = roundScore(components.reduce((acc, c) => acc + (Number.isFinite(c.weight) ? c.weight : 0), 0));
  if (sum !== 100) issues.push({ code: "sumNot100", sum });
  return issues;
}
