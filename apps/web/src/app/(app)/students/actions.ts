"use server";

import { revalidatePath } from "next/cache";
import { auditedMutation, Role, type PrismaClient } from "@educore/db";
import { auditContextFor } from "@/lib/guard";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";
import { existingGuardianLinkSchema, newGuardianLinkSchema, studentSchema, studentStatusSchema } from "@/lib/validation/people";
import { getTranslations } from "next-intl/server";
import { hasStudentCapacity } from "@/lib/entitlements-data";
import { studentUsername } from "@/lib/student-logins";
import { getEntitlements } from "@/lib/entitlements-server";

/** The plan's student limit (4.1): refuses enrolling past it, with a friendly upgrade message. */
async function assertCapacity(tx: PrismaClient, tenantId: string) {
  const { maxStudents } = await getEntitlements(tenantId);
  if (!(await hasStudentCapacity(tx, tenantId, maxStudents))) {
    const t = await getTranslations("people.errors");
    throw new UserFacingError(t("studentLimit", { max: maxStudents ?? 0 }));
  }
}

/**
 * Student and guardian-link actions (milestone 1.2). Same pattern as
 * academics/actions.ts: permission check → validation → RLS transaction with
 * its audit entry → every referenced id re-checked against this school.
 * Students are never hard-deleted; they change status (inactive, withdrawn,
 * graduated) so their history stays intact.
 */

async function must<T>(row: Promise<T | null>): Promise<T> {
  const found = await row;
  if (!found) throw new NotFoundError();
  return found;
}

function revalidate(studentId?: string) {
  revalidatePath("/students");
  if (studentId) revalidatePath(`/students/${studentId}`);
  revalidatePath("/parents");
  revalidatePath("/dashboard");
  revalidatePath("/academics", "layout");
}

/** Class (and section, if given) must belong to this school, and the section to that class. */
async function resolvePlacement(tx: PrismaClient, tenantId: string, classId: string, sectionId: string | undefined) {
  const cls = await must(tx.classGrade.findFirst({ where: { id: classId, tenantId } }));
  if (sectionId) {
    const section = await tx.section.findFirst({ where: { id: sectionId, tenantId, classId: cls.id } });
    if (!section) {
      const t = await getTranslations("people.errors");
      throw new UserFacingError(t("sectionNotInClass"), { sectionId: t("sectionNotInClass") });
    }
  }
  return { classId: cls.id, sectionId: sectionId ?? null, academicYearId: cls.academicYearId };
}

export async function createStudent(input: unknown) {
  return runAction(["student", "create"], async (ctx) => {
    const data = studentSchema.parse(input);
    const audit = auditContextFor(ctx);
    const student = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "Student",
      run: async (tx) => {
        const placement = await resolvePlacement(tx, audit.tenantId, data.classId, data.sectionId);
        await assertCapacity(tx, audit.tenantId);
        const after = await tx.student.create({
          data: {
            tenantId: audit.tenantId,
            admissionNo: data.admissionNo,
            firstName: data.firstName,
            lastName: data.lastName,
            dateOfBirth: data.dateOfBirth ?? null,
            gender: data.gender ?? null,
            ...(data.admissionDate ? { admissionDate: data.admissionDate } : {}),
            ...placement,
          },
        });
        return { after };
      },
    });
    revalidate();
    return { id: student.id };
  });
}

export async function updateStudent(id: unknown, input: unknown) {
  return runAction(["student", "update"], async (ctx) => {
    const studentId = idSchema.parse(id);
    const data = studentSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "Student",
      run: async (tx) => {
        const before = await must(tx.student.findFirst({ where: { id: studentId, tenantId: audit.tenantId } }));
        const placement = await resolvePlacement(tx, audit.tenantId, data.classId, data.sectionId);
        const after = await tx.student.update({
          where: { id: before.id },
          data: {
            admissionNo: data.admissionNo,
            firstName: data.firstName,
            lastName: data.lastName,
            dateOfBirth: data.dateOfBirth ?? null,
            gender: data.gender ?? null,
            ...(data.admissionDate ? { admissionDate: data.admissionDate } : {}),
            ...placement,
          },
        });
        // A student with a login signs in with their admission number: keep it in step (Phase 5.0).
        if (after.userId && (before.admissionNo !== after.admissionNo || before.firstName !== after.firstName || before.lastName !== after.lastName)) {
          const tenant = await tx.tenant.findFirst({ where: { id: audit.tenantId }, select: { slug: true } });
          if (tenant) await tx.user.update({ where: { id: after.userId }, data: { username: studentUsername(tenant.slug, after.admissionNo), name: `${after.firstName} ${after.lastName}` } });
        }
        return { before, after };
      },
    });
    revalidate(studentId);
  });
}

/** Active ↔ inactive / withdrawn / graduated. The student record and history are kept. */
export async function setStudentStatus(id: unknown, status: unknown) {
  return runAction(["student", "update"], async (ctx) => {
    const studentId = idSchema.parse(id);
    const next = studentStatusSchema.parse(status);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "Student",
      run: async (tx) => {
        const before = await must(tx.student.findFirst({ where: { id: studentId, tenantId: audit.tenantId } }));
        if (next === "ACTIVE" && before.status !== "ACTIVE") await assertCapacity(tx, audit.tenantId);
        const after = await tx.student.update({ where: { id: before.id }, data: { status: next } });
        return { before, after };
      },
    });
    revalidate(studentId);
  });
}

// ------------------------------------------------------------ guardians ---

async function makePrimaryIfNeeded(tx: PrismaClient, tenantId: string, studentId: string, linkId: string, isPrimary: boolean) {
  if (!isPrimary) return;
  // One primary contact per student.
  await tx.studentGuardian.updateMany({
    where: { tenantId, studentId, isPrimary: true, NOT: { id: linkId } },
    data: { isPrimary: false },
  });
}

/** Creates a parent account (no password yet — they're invited) and links it to the student. */
export async function addNewGuardian(input: unknown) {
  return runAction(["guardian", "create"], async (ctx) => {
    const data = newGuardianLinkSchema.parse(input);
    const audit = auditContextFor(ctx);
    const user = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "User",
      run: async (tx) => {
        const student = await must(tx.student.findFirst({ where: { id: data.studentId, tenantId: audit.tenantId } }));
        const created = await tx.user.create({
          data: {
            tenantId: audit.tenantId,
            email: data.email,
            name: data.name,
            role: Role.PARENT,
            passwordHash: null,
            guardianProfile: {
              create: { tenantId: audit.tenantId, phone: data.phone ?? null, occupation: data.occupation ?? null },
            },
          },
          include: { guardianProfile: true },
        });
        const link = await tx.studentGuardian.create({
          data: {
            tenantId: audit.tenantId,
            studentId: student.id,
            guardianId: created.guardianProfile!.id,
            relationship: data.relationship,
            isPrimary: data.isPrimary,
          },
        });
        await makePrimaryIfNeeded(tx, audit.tenantId, student.id, link.id, data.isPrimary);
        return { after: { ...created, linkedTo: { studentId: student.id, relationship: data.relationship, isPrimary: data.isPrimary } } };
      },
    });
    revalidate(data.studentId);
    return { userId: user.id };
  });
}

/** Links a parent who already has an account in this school (e.g. a sibling's parent). */
export async function linkExistingGuardian(input: unknown) {
  return runAction(["guardian", "update"], async (ctx) => {
    const data = existingGuardianLinkSchema.parse(input);
    const audit = auditContextFor(ctx);
    const t = await getTranslations("people.errors");
    await auditedMutation(audit, {
      action: "CREATE",
      entityType: "StudentGuardian",
      run: async (tx) => {
        const student = await must(tx.student.findFirst({ where: { id: data.studentId, tenantId: audit.tenantId } }));
        const parent = await tx.user.findFirst({
          where: { tenantId: audit.tenantId, email: data.email, role: Role.PARENT },
          include: { guardianProfile: true },
        });
        if (!parent?.guardianProfile) throw new UserFacingError(t("noParentAccount"), { email: t("noParentAccount") });
        const link = await tx.studentGuardian.create({
          data: {
            tenantId: audit.tenantId,
            studentId: student.id,
            guardianId: parent.guardianProfile.id,
            relationship: data.relationship,
            isPrimary: data.isPrimary,
          },
        });
        await makePrimaryIfNeeded(tx, audit.tenantId, student.id, link.id, data.isPrimary);
        return { after: link };
      },
    });
    revalidate(data.studentId);
  });
}

export async function unlinkGuardian(linkId: unknown) {
  return runAction(["guardian", "update"], async (ctx) => {
    const id = idSchema.parse(linkId);
    const audit = auditContextFor(ctx);
    const link = await auditedMutation(audit, {
      action: "DELETE",
      entityType: "StudentGuardian",
      run: async (tx) => {
        const before = await must(tx.studentGuardian.findFirst({ where: { id, tenantId: audit.tenantId } }));
        await tx.studentGuardian.delete({ where: { id: before.id } });
        return { before, after: before };
      },
    });
    revalidate(link.studentId);
  });
}

export async function setPrimaryGuardian(linkId: unknown) {
  return runAction(["guardian", "update"], async (ctx) => {
    const id = idSchema.parse(linkId);
    const audit = auditContextFor(ctx);
    const link = await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "StudentGuardian",
      run: async (tx) => {
        const before = await must(tx.studentGuardian.findFirst({ where: { id, tenantId: audit.tenantId } }));
        await makePrimaryIfNeeded(tx, audit.tenantId, before.studentId, before.id, true);
        const after = await tx.studentGuardian.update({ where: { id: before.id }, data: { isPrimary: true } });
        return { before, after };
      },
    });
    revalidate(link.studentId);
  });
}
