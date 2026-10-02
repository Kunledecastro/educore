import type { Action, Resource } from "@educore/auth";
import type { PrismaClient } from "@educore/db";
import type { ColumnDef } from "./csv";

export type ImportKindKey = "STUDENTS" | "STAFF" | "CLASSES" | "PAYMENTS";

/**
 * One problem with one row. `message` is an i18n key (validation.* or
 * imports.issues.*) rendered at display time with `params`. `row` is the
 * spreadsheet row number (header = 1); 0 = the file as a whole.
 */
export interface RowIssue {
  row: number;
  column: string | null;
  message: string;
  params?: Record<string, string | number>;
}

export interface ImportOptions {
  academicYearId?: string;
}

export interface ImportContext {
  tenantId: string;
  actorId: string | null;
  options: ImportOptions;
}

export interface AuditEntry {
  action: "CREATE" | "UPDATE";
  entityType: string;
  entityId: string;
  before?: unknown;
  after: unknown;
}

export interface ApplyResult {
  outcome: "created" | "updated";
  audits: AuditEntry[];
}

export type FieldIssue = { column: string | null; message: string; params?: Record<string, string | number> };

/**
 * An importer knows one kind of file. The engine handles parsing, headers,
 * limits, in-file duplicates, batching, savepoints and auditing; the
 * importer only validates one row and writes one row.
 */
export interface Importer<TRow, TLookup> {
  kind: ImportKindKey;
  permission: readonly [Resource, Action];
  columns: ColumnDef[];
  /** Rows are placed into an academic year (students, classes). */
  needsYear: boolean;
  /** Everything validation needs from the database, loaded once per pass. */
  loadLookup(tx: PrismaClient, ctx: ImportContext): Promise<TLookup>;
  /**
   * Validates one row. `seen` lets a row know about entities introduced by
   * EARLIER rows of the same file (e.g. a parent created on a sibling's row).
   */
  validate(record: Record<string, string>, lookup: TLookup, seen: Set<string>): { row?: TRow; issues: FieldIssue[] };
  /** Natural keys that must be unique within the file (e.g. admission number). */
  uniqueKeys(row: TRow): { key: string; column: string }[];
  /** Things this row makes available to later rows (added to `seen`). */
  introduces?(row: TRow): string[];
  /** Creates or updates one row. Runs inside the school's RLS transaction. */
  apply(tx: PrismaClient, ctx: ImportContext, row: TRow): Promise<ApplyResult>;
}
