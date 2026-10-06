/**
 * Assignment marks → a CA score (Phase 5.3). Pure and unit-tested.
 *
 * Each linked assignment gives a pupil a fraction (score ÷ marked out of).
 * Several assignments linked to the same component are averaged, then
 * scaled to what the gradebook column is marked out of, rounded to 2
 * decimal places. Only marked work counts ("not handed in" counts as 0,
 * because the teacher recorded it so). A pupil with no marked work in any
 * linked assignment gets no score — the gradebook cell is left as it is.
 */

export interface LinkedAssignmentMarks {
  maxScore: number;
  /** studentId → score of MARKED work (0 for "not handed in"). Unmarked or absent pupils are left out. */
  scores: ReadonlyMap<string, number>;
}

export interface CaScore {
  score: number;
  /** How many assignments it's averaged over. */
  from: number;
}

export function caScores(studentIds: readonly string[], assignments: readonly LinkedAssignmentMarks[], columnMax: number): Map<string, CaScore | null> {
  const out = new Map<string, CaScore | null>();
  for (const id of studentIds) {
    const fractions: number[] = [];
    for (const a of assignments) {
      const s = a.scores.get(id);
      if (s === undefined || !(a.maxScore > 0)) continue;
      fractions.push(Math.min(1, Math.max(0, s / a.maxScore)));
    }
    if (fractions.length === 0) {
      out.set(id, null);
      continue;
    }
    const avg = fractions.reduce((x, y) => x + y, 0) / fractions.length;
    out.set(id, { score: Math.min(columnMax, Math.round(avg * columnMax * 100) / 100), from: fractions.length });
  }
  return out;
}
