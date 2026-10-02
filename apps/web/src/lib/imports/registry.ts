import { classesImporter } from "./importers/classes";
import { paymentsImporter } from "./importers/payments";
import { staffImporter } from "./importers/staff";
import { studentsImporter } from "./importers/students";
import type { ImportKindKey, Importer } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const IMPORTERS: Record<ImportKindKey, Importer<any, any>> = {
  STUDENTS: studentsImporter,
  STAFF: staffImporter,
  CLASSES: classesImporter,
  PAYMENTS: paymentsImporter,
};

export const IMPORT_KINDS = Object.keys(IMPORTERS) as ImportKindKey[];

export function isImportKind(v: unknown): v is ImportKindKey {
  return typeof v === "string" && v in IMPORTERS;
}

/** The downloadable template: headers plus one example row. */
export function templateFor(kind: ImportKindKey): { headers: string[]; example: string[] } {
  const cols = IMPORTERS[kind].columns;
  return { headers: cols.map((c) => c.header), example: cols.map((c) => c.example) };
}
