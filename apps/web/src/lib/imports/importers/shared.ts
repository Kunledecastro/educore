import type { ZodError } from "zod";
import type { FieldIssue } from "../types";

/** Zod issues → row issues, keyed by the CSV column the user sees. */
export function zodIssues(error: ZodError, columnOf: Record<string, string>): FieldIssue[] {
  return error.issues.map((i) => {
    const field = String(i.path[0] ?? "");
    return { column: columnOf[field] ?? field ?? null, message: i.message };
  });
}

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Loose enum matching: "F", "female", "Female " → FEMALE. */
export function pickEnum<T extends string>(value: string, map: Record<string, T>): T | undefined | null {
  const v = norm(value);
  if (!v) return undefined;
  return map[v] ?? null; // null = present but not recognised
}
