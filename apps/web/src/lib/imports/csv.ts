import Papa from "papaparse";

/**
 * CSV plumbing shared by every importer and exporter. Pure functions — no
 * database, no Next.js — so they're fully unit-tested.
 */

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB (also a DB CHECK constraint)
export const MAX_ROWS = 5000;

/**
 * Bytes → text. Files saved from Excel on Windows are often Windows-1252,
 * not UTF-8; decoding them as UTF-8 would mangle names like "Adéwálé".
 * Strict UTF-8 first, Windows-1252 as the fallback. BOM stripped.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export interface ParsedCsv {
  headers: string[];
  /** Data rows; `line` is the spreadsheet row number users see (header = row 1). */
  rows: { line: number; cells: string[] }[];
}

/** Parses CSV text (comma or semicolon, quoted fields, CRLF). Blank lines are skipped. */
export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false, delimitersToGuess: [",", ";", "\t"] });
  const all = result.data as string[][];
  const headerIndex = all.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerIndex === -1) return { headers: [], rows: [] };
  const headers = all[headerIndex]!.map((h) => h.trim());
  const rows: ParsedCsv["rows"] = [];
  for (let i = headerIndex + 1; i < all.length; i++) {
    const cells = all[i]!;
    if (cells.every((c) => (c ?? "").trim() === "")) continue;
    rows.push({ line: i + 1, cells: cells.map((c) => (c ?? "").trim()) });
  }
  return { headers, rows };
}

/** "Admission No.", "admission_no", "AdmissionNo" → "admissionno". */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface ColumnDef {
  key: string;
  /** Header used in the downloadable template. */
  header: string;
  aliases?: string[];
  required: boolean;
  example: string;
}

export interface HeaderMatch {
  /** column key → index in the file's row */
  indexOf: Record<string, number>;
  missingRequired: string[];
  unknownHeaders: string[];
  duplicateHeaders: string[];
}

export function matchHeaders(headers: string[], columns: ColumnDef[]): HeaderMatch {
  const lookup = new Map<string, string>();
  for (const c of columns) for (const name of [c.header, c.key, ...(c.aliases ?? [])]) lookup.set(normalizeHeader(name), c.key);
  const indexOf: Record<string, number> = {};
  const unknownHeaders: string[] = [];
  const duplicateHeaders: string[] = [];
  headers.forEach((h, i) => {
    if (!h) return;
    const key = lookup.get(normalizeHeader(h));
    if (!key) unknownHeaders.push(h);
    else if (key in indexOf) duplicateHeaders.push(h);
    else indexOf[key] = i;
  });
  const missingRequired = columns.filter((c) => c.required && !(c.key in indexOf)).map((c) => c.header);
  return { indexOf, missingRequired, unknownHeaders, duplicateHeaders };
}

export function rowToRecord(cells: string[], indexOf: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, i] of Object.entries(indexOf)) out[key] = cells[i] ?? "";
  return out;
}

/**
 * Dates as schools type them. ISO (2015-03-07) always works; slashed/dashed
 * dates are read DAY-FIRST (07/03/2015 = 7 March), the convention in Nigeria
 * and most of the world. ASSUMPTION: schools using month-first dates must
 * use ISO format — the template says so. Returns "YYYY-MM-DD" or null.
 */
export function parseDayFirstDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso || y < 1900 || y > 2200) return null;
  return iso;
}

/**
 * Spreadsheet formula injection: a cell starting with = + - @ (or tab/CR)
 * is executed by Excel when the export is opened. Prefix with an apostrophe
 * so it's shown as text. Applied to every exported cell.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = neutralizeFormula(v === null || v === undefined ? "" : String(v));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens UTF-8 names correctly.
  return "﻿" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
