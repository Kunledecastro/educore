import { recordAudit, type PrismaClient } from "@educore/db";
import { matchHeaders, MAX_ROWS, parseCsv, rowToRecord } from "./csv";
import type { ImportContext, Importer, RowIssue } from "./types";

/** Cap on stored issues so a completely wrong file doesn't produce a 5,000-line report. */
export const MAX_STORED_ISSUES = 500;

export interface ValidationReport<TRow> {
  totalRows: number;
  /** Row number → parsed row, for rows that passed. */
  valid: Map<number, TRow>;
  /** Number of distinct rows with at least one problem. */
  errorRows: number;
  issues: RowIssue[];
  /** A problem with the file itself (missing columns, empty, too big) — nothing can be imported. */
  fatal: boolean;
}

/**
 * Parses and validates a whole file against an importer. Pure apart from
 * the lookup the caller loaded, so the upload action and every background
 * batch make exactly the same decision about every row.
 */
export function validateCsv<TRow, TLookup>(
  importer: Importer<TRow, TLookup>,
  text: string,
  lookup: TLookup,
): ValidationReport<TRow> {
  const { headers, rows } = parseCsv(text);
  const fileIssue = (message: string, params?: RowIssue["params"]): ValidationReport<TRow> => ({
    totalRows: rows.length,
    valid: new Map(),
    errorRows: 0,
    issues: [{ row: 0, column: null, message, params }],
    fatal: true,
  });

  if (headers.length === 0 || rows.length === 0) return fileIssue("imports.issues.emptyFile");
  if (rows.length > MAX_ROWS) return fileIssue("imports.issues.tooManyRows", { max: MAX_ROWS, count: rows.length });

  const match = matchHeaders(headers, importer.columns);
  if (match.missingRequired.length) return fileIssue("imports.issues.missingColumns", { columns: match.missingRequired.join(", ") });
  if (match.duplicateHeaders.length) return fileIssue("imports.issues.duplicateColumns", { columns: match.duplicateHeaders.join(", ") });

  const issues: RowIssue[] = [];
  if (match.unknownHeaders.length) {
    // Not fatal: extra columns (e.g. "Notes") are simply ignored — but say so.
    issues.push({ row: 0, column: null, message: "imports.issues.ignoredColumns", params: { columns: match.unknownHeaders.join(", ") } });
  }

  const valid = new Map<number, TRow>();
  const firstSeenAt = new Map<string, number>();
  const seen = new Set<string>();
  let errorRows = 0;

  for (const { line, cells } of rows) {
    const record = rowToRecord(cells, match.indexOf);
    const { row, issues: rowIssues } = importer.validate(record, lookup, seen);
    const problems = rowIssues.map((i) => ({ row: line, ...i }));

    if (row) {
      for (const { key, column } of importer.uniqueKeys(row)) {
        const earlier = firstSeenAt.get(key);
        if (earlier !== undefined) problems.push({ row: line, column, message: "imports.issues.duplicateInFile", params: { row: earlier } });
      }
    }

    if (problems.length === 0 && row) {
      valid.set(line, row);
      for (const { key } of importer.uniqueKeys(row)) firstSeenAt.set(key, line);
      for (const k of importer.introduces?.(row) ?? []) seen.add(k);
    } else {
      errorRows++;
      issues.push(...problems);
    }
  }

  return { totalRows: rows.length, valid, errorRows, issues: issues.slice(0, MAX_STORED_ISSUES), fatal: false };
}

export interface BatchResult {
  created: number;
  updated: number;
  failed: number;
  issues: RowIssue[];
}

/**
 * Writes the given rows inside the caller's RLS transaction. Each row runs
 * in its own SAVEPOINT: one bad row (say, an email already used by another
 * school) is rolled back and reported without undoing the rest of the
 * batch. Every written row gets its audit entries in the same transaction.
 *
 * Imports are idempotent — importers upsert on natural keys (admission
 * number, email, class name) — so a retried batch updates rather than
 * duplicates.
 */
export async function applyRows<TRow, TLookup>(
  tx: PrismaClient,
  importer: Importer<TRow, TLookup>,
  ctx: ImportContext & { ipAddress?: string | null },
  rows: { line: number; row: TRow }[],
  describeError: (err: unknown) => string,
): Promise<BatchResult> {
  const result: BatchResult = { created: 0, updated: 0, failed: 0, issues: [] };
  const audit = { tenantId: ctx.tenantId, actorId: ctx.actorId, ipAddress: ctx.ipAddress ?? null, userAgent: "EduCore import" };

  for (const { line, row } of rows) {
    await tx.$executeRawUnsafe("SAVEPOINT import_row");
    try {
      const { outcome, audits } = await importer.apply(tx, ctx, row);
      for (const a of audits) await recordAudit(audit, a, tx);
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_row");
      if (outcome === "created") result.created++;
      else result.updated++;
    } catch (err) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT import_row");
      result.failed++;
      result.issues.push({ row: line, column: null, message: describeError(err) });
    }
  }
  return result;
}
