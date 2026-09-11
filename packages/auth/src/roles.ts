/**
 * Plain, ORM-independent mirror of the `Role` enum in
 * packages/db/prisma/schema.prisma. Values must stay byte-for-byte in sync
 * with the Prisma enum — a test in this package asserts that.
 *
 * Why this exists instead of importing Prisma's generated `Role`: the RBAC
 * permission matrix is pure logic (no database access) and should be usable
 * — and unit-testable — without generating a Prisma Client first. Every
 * route that actually touches the database still uses the Prisma `Role`
 * from @educore/db; the two are structurally identical string-literal
 * unions, so a Prisma `Role` value is assignable wherever this `Role` type
 * is expected with no cast required.
 */
export const Role = {
  PLATFORM_ADMIN: "PLATFORM_ADMIN",
  SCHOOL_ADMIN: "SCHOOL_ADMIN",
  TEACHER: "TEACHER",
  STUDENT: "STUDENT",
  PARENT: "PARENT",
  ACCOUNTANT: "ACCOUNTANT",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ALL_ROLES: readonly Role[] = Object.values(Role);
