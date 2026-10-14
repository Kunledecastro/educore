import { z } from "zod";
import { idSchema, V } from "../validation/common";

/**
 * Staff leave (Phase 8.2): the rules, pure and unit-tested.
 *
 * - Leave is counted in working days, Monday to Friday. (School holidays
 *   and public holidays aren't excluded yet.)
 * - Each type has a number of days per school year; the balance resets
 *   with the academic year (no carry-over).
 * - Pending requests count against the balance, so two requests can't
 *   together go over it.
 */

/** What a new school starts with; it can rename, change or switch any off. */
export const DEFAULT_LEAVE_TYPES = [
  { name: "Annual leave", daysPerYear: 20 },
  { name: "Sick leave", daysPerYear: 12 },
  { name: "Casual leave", daysPerYear: 5 },
  { name: "Maternity leave", daysPerYear: 60 },
  { name: "Paternity leave", daysPerYear: 5 },
] as const;

/** Roles that take leave. */
export const STAFF_ROLES = ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "SCHOOL_NURSE"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z
  .string({ required_error: V.required })
  .regex(ISO_DATE, V.invalidDate)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), V.invalidDate);

export const leaveRequestSchema = z
  .object({
    leaveTypeId: idSchema,
    startDate: dateSchema,
    endDate: dateSchema,
    note: z.string().trim().max(300, V.tooLong).default(""),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "validation.endBeforeStart" });
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;

export const leaveTypeSchema = z.object({
  id: idSchema.nullable().default(null),
  name: z.string({ required_error: V.required }).trim().min(1, V.required).max(60, V.tooLong),
  daysPerYear: z.coerce.number({ invalid_type_error: V.required }).int().min(0).max(366),
  isActive: z.boolean().default(true),
});

/** A YYYY-MM-DD as a UTC midnight date. */
export function day(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Working days (Mon–Fri) from start to end, both included. */
export function workingDays(start: Date, end: Date): number {
  if (end < start) return 0;
  let n = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export interface Balance {
  allowance: number;
  taken: number;
  pending: number;
  left: number;
}
export function balance(allowance: number, taken: number, pending: number): Balance {
  return { allowance, taken, pending, left: Math.max(0, allowance - taken - pending) };
}

export type LeaveRefusal = "noWorkingDays" | "outsideYear" | "overlap" | "balance" | "typeInactive";

/** Why a request can't go ahead, or null. */
export function checkRequest(input: {
  start: Date;
  end: Date;
  year: { startDate: Date; endDate: Date };
  typeActive: boolean;
  allowance: number;
  taken: number;
  pending: number;
  others: readonly { start: Date; end: Date }[];
}): { refusal: LeaveRefusal | null; days: number } {
  const days = workingDays(input.start, input.end);
  if (!input.typeActive) return { refusal: "typeInactive", days };
  if (days === 0) return { refusal: "noWorkingDays", days };
  if (input.start < input.year.startDate || input.end > input.year.endDate) return { refusal: "outsideYear", days };
  if (input.others.some((o) => overlaps({ start: input.start, end: input.end }, o))) return { refusal: "overlap", days };
  if (days > balance(input.allowance, input.taken, input.pending).left) return { refusal: "balance", days };
  return { refusal: null, days };
}

/** The weeks of a month for the leave calendar (Mon–Sun rows of UTC dates; days outside the month are null). */
export function monthDays(year: number, month0: number): Date[] {
  const out: Date[] = [];
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  for (let d = 1; d <= last; d++) out.push(new Date(Date.UTC(year, month0, d)));
  return out;
}
