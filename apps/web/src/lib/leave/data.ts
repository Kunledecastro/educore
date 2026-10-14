import "server-only";
import { recordAudit, withRls, type AuditContext, type PrismaClient } from "@educore/db";
import { checkRequest, day, DEFAULT_LEAVE_TYPES, iso, leaveTypeSchema, STAFF_ROLES, workingDays, balance, type Balance, type LeaveRefusal, type LeaveRequest } from "./rules";

/**
 * Staff leave (Phase 8.2). Requests are approval requests (process LEAVE):
 * nothing is booked until a school admin approves, and then an approved
 * `staff_leave` row is written in the approval's transaction. Every read
 * runs inside the school's walls (RLS); staff see their own leave, admins
 * everyone's.
 */

type Tx = PrismaClient;

export class LeaveError extends Error {
  constructor(public readonly code: "notFound" | "notAllowed" | "noYear" | LeaveRefusal) {
    super(code);
    this.name = "LeaveError";
  }
}

export const leaveTargetKey = (userId: string, p: Pick<LeaveRequest, "leaveTypeId" | "startDate" | "endDate">) => `${userId}:${p.leaveTypeId}:${p.startDate}:${p.endDate}`;

/** A new school gets the default leave types the first time leave is opened. */
export async function ensureLeaveTypes(tx: Tx, tenantId: string) {
  if ((await tx.leaveType.count()) > 0) return;
  await tx.leaveType.createMany({ data: DEFAULT_LEAVE_TYPES.map((t, i) => ({ tenantId, name: t.name, daysPerYear: t.daysPerYear, order: i })), skipDuplicates: true });
}

interface PendingLeave {
  targetKey: string;
  leaveTypeId: string;
  start: Date;
  end: Date;
  days: number;
}

async function pendingOf(tx: Tx, tenantId: string, userId: string): Promise<PendingLeave[]> {
  const rows = await tx.approvalRequest.findMany({ where: { tenantId, process: "LEAVE", status: "PENDING", requestedById: userId }, select: { targetKey: true, payload: true } });
  return rows.map((r) => {
    const p = r.payload as { leaveTypeId: string; startDate: string; endDate: string };
    const start = day(p.startDate);
    const end = day(p.endDate);
    return { targetKey: r.targetKey, leaveTypeId: p.leaveTypeId, start, end, days: workingDays(start, end) };
  });
}

/**
 * Can this person take this leave? Used when they ask, and again at final
 * approval (excluding the request being approved from "pending").
 */
export async function assessLeave(tx: Tx, tenantId: string, userId: string, p: LeaveRequest, opts: { excludeTargetKey?: string } = {}) {
  const year = await tx.academicYear.findFirst({ where: { tenantId, isActive: true }, select: { id: true, name: true, startDate: true, endDate: true } });
  if (!year) throw new LeaveError("noYear");
  const type = await tx.leaveType.findFirst({ where: { id: p.leaveTypeId, tenantId } });
  if (!type) throw new LeaveError("notFound");
  const [approved, pendingAll] = await Promise.all([
    tx.staffLeave.findMany({ where: { tenantId, userId, academicYearId: year.id, status: "APPROVED" }, select: { leaveTypeId: true, startDate: true, endDate: true, days: true } }),
    pendingOf(tx, tenantId, userId),
  ]);
  const pending = pendingAll.filter((x) => x.targetKey !== opts.excludeTargetKey);
  const start = day(p.startDate);
  const end = day(p.endDate);
  const result = checkRequest({
    start,
    end,
    year,
    typeActive: type.isActive,
    allowance: type.daysPerYear,
    taken: approved.filter((a) => a.leaveTypeId === type.id).reduce((n, a) => n + a.days, 0),
    pending: pending.filter((x) => x.leaveTypeId === type.id).reduce((n, x) => n + x.days, 0),
    others: [...approved.map((a) => ({ start: a.startDate, end: a.endDate })), ...pending.map((x) => ({ start: x.start, end: x.end }))],
  });
  return { ...result, year, type };
}

/** Final approval: book the leave. */
export async function bookLeave(tx: Tx, audit: AuditContext, p: LeaveRequest) {
  const userId = audit.actorId!;
  const a = await assessLeave(tx, audit.tenantId, userId, p, { excludeTargetKey: leaveTargetKey(userId, p) });
  if (a.refusal) throw new LeaveError(a.refusal);
  const after = await tx.staffLeave.create({ data: { tenantId: audit.tenantId, userId, leaveTypeId: a.type.id, academicYearId: a.year.id, startDate: day(p.startDate), endDate: day(p.endDate), days: a.days, note: p.note } });
  await recordAudit(audit, { action: "CREATE", entityType: "StaffLeave", entityId: after.id, before: null, after }, tx);
  return after;
}

export interface MyLeave {
  yearName: string | null;
  types: { id: string; name: string; isActive: boolean; balance: Balance }[];
  requests: { id: string; status: string; leaveType: string; startDate: string; endDate: string; days: number; note: string; createdAt: Date; failureCode: string | null }[];
  booked: { id: string; leaveType: string; startDate: string; endDate: string; days: number; status: string }[];
}

/** One person's leave this school year: balances, requests and booked leave. */
export async function myLeave(tenantId: string, userId: string): Promise<MyLeave> {
  return withRls(tenantId, async (tx) => {
    await ensureLeaveTypes(tx, tenantId);
    const [year, types] = await Promise.all([
      tx.academicYear.findFirst({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
      tx.leaveType.findMany({ where: { tenantId }, orderBy: [{ order: "asc" }, { name: "asc" }] }),
    ]);
    const typeName = new Map(types.map((t) => [t.id, t.name]));
    const [booked, requests, pending] = await Promise.all([
      year ? tx.staffLeave.findMany({ where: { tenantId, userId, academicYearId: year.id }, orderBy: { startDate: "desc" } }) : Promise.resolve([]),
      tx.approvalRequest.findMany({ where: { tenantId, process: "LEAVE", requestedById: userId }, orderBy: { createdAt: "desc" }, take: 30 }),
      pendingOf(tx, tenantId, userId),
    ]);
    return {
      yearName: year?.name ?? null,
      types: types
        .filter((t) => t.isActive || booked.some((b) => b.leaveTypeId === t.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          isActive: t.isActive,
          balance: balance(
            t.daysPerYear,
            booked.filter((b) => b.leaveTypeId === t.id && b.status === "APPROVED").reduce((n, b) => n + b.days, 0),
            pending.filter((x) => x.leaveTypeId === t.id).reduce((n, x) => n + x.days, 0),
          ),
        })),
      requests: requests.map((r) => {
        const p = r.payload as { leaveTypeId: string; startDate: string; endDate: string; note?: string };
        return { id: r.id, status: r.status, leaveType: typeName.get(p.leaveTypeId) ?? "—", startDate: p.startDate, endDate: p.endDate, days: workingDays(day(p.startDate), day(p.endDate)), note: p.note ?? "", createdAt: r.createdAt, failureCode: r.failureCode };
      }),
      booked: booked.map((b) => ({ id: b.id, leaveType: typeName.get(b.leaveTypeId) ?? "—", startDate: iso(b.startDate), endDate: iso(b.endDate), days: b.days, status: b.status })),
    };
  });
}

export interface CalendarEntry {
  id: string;
  kind: "approved" | "pending";
  userId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
}

/** Admins: who is away (approved) or asking (pending) in a month. */
export async function leaveCalendar(tenantId: string, monthStart: Date): Promise<{ staff: { id: string; name: string; role: string }[]; entries: CalendarEntry[] }> {
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
  return withRls(tenantId, async (tx) => {
    const [staff, types, approved, pending] = await Promise.all([
      tx.user.findMany({ where: { tenantId, isActive: true, role: { in: [...STAFF_ROLES] } }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
      tx.leaveType.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      tx.staffLeave.findMany({ where: { tenantId, status: "APPROVED", startDate: { lte: monthEnd }, endDate: { gte: monthStart } } }),
      tx.approvalRequest.findMany({ where: { tenantId, process: "LEAVE", status: "PENDING" }, select: { id: true, requestedById: true, payload: true } }),
    ]);
    const typeName = new Map(types.map((t) => [t.id, t.name]));
    const entries: CalendarEntry[] = approved.map((a) => ({ id: a.id, kind: "approved", userId: a.userId, leaveType: typeName.get(a.leaveTypeId) ?? "—", startDate: iso(a.startDate), endDate: iso(a.endDate), days: a.days }));
    for (const r of pending) {
      const p = r.payload as { leaveTypeId: string; startDate: string; endDate: string };
      const s = day(p.startDate);
      const e = day(p.endDate);
      if (r.requestedById && s <= monthEnd && e >= monthStart) entries.push({ id: r.id, kind: "pending", userId: r.requestedById, leaveType: typeName.get(p.leaveTypeId) ?? "—", startDate: p.startDate, endDate: p.endDate, days: workingDays(s, e) });
    }
    return { staff: staff.map((u) => ({ id: u.id, name: u.name ?? u.email, role: u.role })), entries };
  });
}

/** Admins: cancel approved leave (e.g. the person came back early or it was booked by mistake). The days return to the balance. */
export async function cancelLeave(audit: AuditContext, leaveId: string) {
  await withRls(audit.tenantId, async (tx) => {
    const before = await tx.staffLeave.findFirst({ where: { id: leaveId, tenantId: audit.tenantId } });
    if (!before) throw new LeaveError("notFound");
    if (before.status !== "APPROVED") return;
    const after = await tx.staffLeave.update({ where: { id: before.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: audit.actorId } });
    await recordAudit(audit, { action: "UPDATE", entityType: "StaffLeave", entityId: before.id, before, after }, tx);
  });
}

/** Admins: the school's leave types. */
export async function leaveTypesForSettings(tenantId: string) {
  return withRls(tenantId, async (tx) => {
    await ensureLeaveTypes(tx, tenantId);
    return tx.leaveType.findMany({ where: { tenantId }, orderBy: [{ order: "asc" }, { name: "asc" }] });
  });
}

/** Admins: add or change a leave type (types are switched off, never deleted). Audited. */
export async function saveLeaveType(audit: AuditContext, input: unknown) {
  const v = leaveTypeSchema.parse(input);
  return withRls(audit.tenantId, async (tx) => {
    if (v.id) {
      const before = await tx.leaveType.findFirst({ where: { id: v.id, tenantId: audit.tenantId } });
      if (!before) throw new LeaveError("notFound");
      const after = await tx.leaveType.update({ where: { id: before.id }, data: { name: v.name, daysPerYear: v.daysPerYear, isActive: v.isActive } });
      await recordAudit(audit, { action: "UPDATE", entityType: "LeaveType", entityId: after.id, before, after }, tx);
      return after;
    }
    const order = await tx.leaveType.count({ where: { tenantId: audit.tenantId } });
    const after = await tx.leaveType.create({ data: { tenantId: audit.tenantId, name: v.name, daysPerYear: v.daysPerYear, isActive: v.isActive, order } });
    await recordAudit(audit, { action: "CREATE", entityType: "LeaveType", entityId: after.id, before: null, after }, tx);
    return after;
  });
}
