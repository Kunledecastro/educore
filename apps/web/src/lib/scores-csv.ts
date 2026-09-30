/**
 * Score import for one gradebook (section + subject + term), milestone 2.2.
 * Pure: turns a parsed CSV into gradebook cells plus a row-by-row list of
 * problems. Nothing is saved here — the cells are put into the grid for the
 * teacher to check, and saving goes through the normal audited save.
 *
 * File shape (the gradebook's own export): an admission-number column, then
 * one column per score component named as in settings ("CA1", "Exam" …).
 * Name / total / grade columns are ignored. A blank cell leaves that score
 * as it is — it never clears one.
 */
import { normalizeHeader, type ParsedCsv } from "./imports/csv";
import { isValidScore } from "./results";

export interface ScoreCell {
  studentId: string;
  componentId: string;
  score: number;
}

export type ScoreIssue =
  | { row: number; code: "unknownStudent"; value: string }
  | { row: number; code: "duplicateStudent"; value: string }
  | { row: number; code: "notANumber"; column: string; value: string }
  | { row: number; code: "outOfRange"; column: string; value: string; max: number }
  | { row: 0; code: "noAdmissionColumn" }
  | { row: 0; code: "noComponentColumns" };

const ADMISSION_HEADERS = new Set(["admissionno", "admissionnumber", "admno", "admission"]);
/** Our export's extra columns — expected, so not reported as unknown. */
const KNOWN_EXTRA = new Set(["lastname", "firstname", "name", "student", "total", "grade", "remark"]);

/** "12.5" and "12,5" → 12.5; "", "-" → blank; anything else → NaN. */
function parseScore(raw: string): number | null {
  const v = raw.trim();
  if (v === "" || v === "-") return null;
  if (!/^\d+([.,]\d+)?$/.test(v)) return Number.NaN;
  return Number(v.replace(",", "."));
}

export function mapScoresCsv(
  parsed: ParsedCsv,
  students: readonly { id: string; admissionNo: string }[],
  components: readonly { id: string; name: string; maxScore: number }[],
): { cells: ScoreCell[]; issues: ScoreIssue[]; ignoredColumns: string[]; rowsRead: number } {
  const headers = parsed.headers.map(normalizeHeader);
  const admissionIdx = headers.findIndex((h) => ADMISSION_HEADERS.has(h));
  const componentByHeader = new Map(components.map((c) => [normalizeHeader(c.name), c]));
  const componentCols = headers
    .map((h, i) => ({ i, component: componentByHeader.get(h) }))
    .filter((c): c is { i: number; component: (typeof components)[number] } => Boolean(c.component));

  const issues: ScoreIssue[] = [];
  if (admissionIdx === -1) issues.push({ row: 0, code: "noAdmissionColumn" });
  if (componentCols.length === 0) issues.push({ row: 0, code: "noComponentColumns" });
  const ignoredColumns = parsed.headers.filter((h, i) => i !== admissionIdx && !componentCols.some((c) => c.i === i) && !KNOWN_EXTRA.has(headers[i]!) && h.trim() !== "");
  if (issues.length) return { cells: [], issues, ignoredColumns, rowsRead: 0 };

  const byAdmission = new Map(students.map((s) => [s.admissionNo.trim().toLowerCase(), s]));
  const seen = new Set<string>();
  const cells: ScoreCell[] = [];

  for (const { line, cells: raw } of parsed.rows) {
    const admission = (raw[admissionIdx] ?? "").trim();
    const student = byAdmission.get(admission.toLowerCase());
    if (!student) {
      issues.push({ row: line, code: "unknownStudent", value: admission });
      continue;
    }
    if (seen.has(student.id)) {
      issues.push({ row: line, code: "duplicateStudent", value: admission });
      continue;
    }
    seen.add(student.id);
    for (const { i, component } of componentCols) {
      const value = raw[i] ?? "";
      const score = parseScore(value);
      if (score === null) continue;
      if (Number.isNaN(score)) issues.push({ row: line, code: "notANumber", column: component.name, value });
      else if (!isValidScore(score, component.maxScore)) issues.push({ row: line, code: "outOfRange", column: component.name, value, max: component.maxScore });
      else cells.push({ studentId: student.id, componentId: component.id, score });
    }
  }
  return { cells, issues, ignoredColumns, rowsRead: parsed.rows.length };
}
