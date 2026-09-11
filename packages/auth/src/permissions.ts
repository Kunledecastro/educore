import { Role } from "./roles";

/**
 * Single source of truth for RBAC (architecture rule #2). Every API route
 * MUST check permissions via `can()` (or the `requirePermission` guard in
 * `guard.ts`) rather than re-deriving role logic inline.
 *
 * Two layers of authorization are modeled here:
 *   1. Coarse-grained: "can this role perform this action on this resource
 *      type at all?" — PERMISSION_MATRIX below.
 *   2. Row-level scoping: "can this specific user act on this specific row?"
 *      — the `Scope` predicates further down (e.g. a parent may only ever
 *      read their own children's records, never another family's).
 *
 * Both layers must pass. Coarse-grained denial short-circuits before a
 * database row is ever fetched; row-level scoping is enforced once the row
 * is in hand (or, preferably, folded into the Prisma `where` clause so a
 * denied row is never fetched in the first place).
 */

export const RESOURCES = [
  "tenant",
  "subscription",
  "user",
  "academicYear",
  "classGrade",
  "section",
  "subject",
  "teacherAssignment",
  "student",
  "guardian",
  "teacher",
  "staff",
  "attendance",
  "assessment",
  "mark",
  "reportCard",
  "timetable",
  "announcement",
  "feeStructure",
  "invoice",
  "payment",
  "message",
  "auditLog",
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["create", "read", "update", "delete", "export", "import"] as const;
export type Action = (typeof ACTIONS)[number];

type Matrix = Record<Role, Partial<Record<Resource, readonly Action[]>>>;

const ALL: readonly Action[] = ACTIONS;
const RW: readonly Action[] = ["create", "read", "update"];
const R: readonly Action[] = ["read"];
const RE: readonly Action[] = ["read", "export"];
const CRUDE: readonly Action[] = ["create", "read", "update", "delete", "export"];

export const PERMISSION_MATRIX: Matrix = {
  // Operates above tenant isolation entirely — see packages/db forTenant().
  // Full CRUD everywhere EXCEPT the audit log, which is append-only for
  // every role without exception (architecture rule #3: "Immutable"). A
  // tamper-proof audit trail that its own auditor could edit isn't one.
  [Role.PLATFORM_ADMIN]: {
    ...(Object.fromEntries(RESOURCES.map((r) => [r, ALL])) as Matrix[typeof Role.PLATFORM_ADMIN]),
    auditLog: RE,
  },

  [Role.SCHOOL_ADMIN]: {
    tenant: R, // read own tenant's settings/branding; cannot escalate plan
    subscription: R,
    user: CRUDE,
    academicYear: CRUDE,
    classGrade: CRUDE,
    section: CRUDE,
    subject: CRUDE,
    teacherAssignment: CRUDE,
    student: [...CRUDE, "import"],
    guardian: CRUDE,
    teacher: [...CRUDE, "import"],
    staff: [...CRUDE, "import"],
    attendance: RE,
    assessment: CRUDE,
    mark: RE,
    reportCard: RE,
    timetable: CRUDE,
    announcement: CRUDE,
    feeStructure: CRUDE,
    invoice: [...CRUDE, "import"],
    payment: RE,
    message: RW,
    auditLog: R, // read-only, immutable — even for SCHOOL_ADMIN
  },

  [Role.ACCOUNTANT]: {
    student: R,
    guardian: R,
    feeStructure: CRUDE,
    invoice: [...CRUDE, "import"],
    payment: [...RW, "export"],
    announcement: R,
    auditLog: R,
  },

  [Role.TEACHER]: {
    student: R, // scoped to their assigned sections — see Scope below
    academicYear: R,
    classGrade: R,
    section: R,
    subject: R,
    teacherAssignment: R,
    attendance: RW, // only for their own assigned sections
    assessment: RW, // only for subjects they teach
    mark: RW,
    reportCard: R,
    timetable: R,
    announcement: RW,
    message: RW,
  },

  [Role.PARENT]: {
    student: R, // scoped to their own children
    attendance: R,
    mark: R,
    reportCard: R,
    invoice: R,
    payment: [...R, "create"], // may submit a payment against their child's invoice
    announcement: R,
    timetable: R,
    message: RW,
  },

  [Role.STUDENT]: {
    student: R, // scoped to self only
    attendance: R,
    mark: R,
    reportCard: R,
    timetable: R,
    announcement: R,
    invoice: R,
    message: RW,
  },
};

export function can(role: Role, resource: Resource, action: Action): boolean {
  const allowed = PERMISSION_MATRIX[role]?.[resource];
  return Boolean(allowed && (allowed as readonly Action[]).includes(action));
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertPermission(role: Role, resource: Resource, action: Action): void {
  if (!can(role, resource, action)) {
    throw new ForbiddenError(`Role ${role} may not ${action} ${resource}`);
  }
}

// ---------------------------------------------------------------------------
// Row-level scope predicates (layer 2)
// ---------------------------------------------------------------------------

/** Minimal shape guard functions need — matches the Auth.js session user. */
export interface AuthUser {
  id: string;
  tenantId: string | null;
  role: Role;
}

/**
 * Builds the Prisma `where` fragment a query must AND-in for a given role so
 * that row-level scoping is enforced at the database query itself, never
 * only after the fact in application code. `studentIds` and `sectionIds` are
 * pre-resolved by the caller (e.g. "sections this teacher is assigned to",
 * "students linked to this guardian") — this function only encodes which
 * field to filter on for each role.
 */
export function studentScopeWhere(
  user: AuthUser,
  ctx: { ownStudentId?: string; guardianStudentIds?: string[]; teacherSectionIds?: string[] },
) {
  switch (user.role) {
    case "PLATFORM_ADMIN":
    case "SCHOOL_ADMIN":
    case "ACCOUNTANT":
      return {}; // tenant-wide, already scoped by forTenant()
    case "TEACHER":
      return { sectionId: { in: ctx.teacherSectionIds ?? [] } };
    case "PARENT":
      return { id: { in: ctx.guardianStudentIds ?? [] } };
    case "STUDENT":
      return { id: ctx.ownStudentId ?? "__none__" };
    default:
      return { id: "__none__" };
  }
}
