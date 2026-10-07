"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditedMutation, prisma, recordAudit, Role } from "@educore/db";
import { auditContextFor, forbidWhileImpersonating } from "@/lib/guard";
import { escapeHtml, isEmailConfigured, sendEmail } from "@/lib/email";
import { generateInviteToken, inviteIdentifier } from "@/lib/invite-token";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";
import { guardianSchema, staffSchema, teacherSchema } from "@/lib/validation/people";

/**
 * Teachers, staff and parent accounts (milestone 1.2). People are never
 * hard-deleted — deactivating an account blocks sign-in immediately (the
 * credentials check requires isActive) while keeping their history.
 */

function revalidatePeople() {
  for (const p of ["/teachers", "/staff", "/parents", "/students", "/academics/assignments", "/dashboard"]) revalidatePath(p);
}

async function must<T>(row: Promise<T | null>): Promise<T> {
  const found = await row;
  if (!found) throw new NotFoundError();
  return found;
}

// --------------------------------------------------------------- teachers ---

export async function createTeacher(input: unknown) {
  return runAction(["teacher", "create"], async (ctx) => {
    const data = teacherSchema.parse(input);
    const audit = auditContextFor(ctx);
    const user = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "User",
      run: async (tx) => ({
        after: await tx.user.create({
          data: {
            tenantId: audit.tenantId,
            email: data.email,
            name: data.name,
            role: Role.TEACHER,
            passwordHash: null,
            teacherProfile: {
              create: {
                tenantId: audit.tenantId,
                employeeId: data.employeeId,
                department: data.department ?? null,
                qualification: data.qualification ?? null,
                ...(data.joiningDate ? { joiningDate: data.joiningDate } : {}),
              },
            },
          },
          include: { teacherProfile: true },
        }),
      }),
    });
    revalidatePeople();
    return { userId: user.id };
  });
}

export async function updateTeacher(userId: unknown, input: unknown) {
  return runAction(["teacher", "update"], async (ctx) => {
    const id = idSchema.parse(userId);
    const data = teacherSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "User",
      run: async (tx) => {
        const before = await must(
          tx.user.findFirst({ where: { id, tenantId: audit.tenantId, role: Role.TEACHER }, include: { teacherProfile: true } }),
        );
        const after = await tx.user.update({
          where: { id: before.id },
          data: {
            name: data.name,
            email: data.email,
            teacherProfile: {
              update: {
                employeeId: data.employeeId,
                department: data.department ?? null,
                qualification: data.qualification ?? null,
                ...(data.joiningDate ? { joiningDate: data.joiningDate } : {}),
              },
            },
          },
          include: { teacherProfile: true },
        });
        return { before, after };
      },
    });
    revalidatePeople();
  });
}

// ------------------------------------------------------------------ staff ---

export async function createStaff(input: unknown) {
  return runAction(["staff", "create"], async (ctx) => {
    const data = staffSchema.parse(input);
    const audit = auditContextFor(ctx);
    const user = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "User",
      run: async (tx) => ({
        after: await tx.user.create({
          data: {
            tenantId: audit.tenantId,
            email: data.email,
            name: data.name,
            role: data.role,
            passwordHash: null,
            staffProfile: {
              create: {
                tenantId: audit.tenantId,
                employeeId: data.employeeId,
                designation: data.designation ?? null,
                department: data.department ?? null,
                ...(data.joiningDate ? { joiningDate: data.joiningDate } : {}),
              },
            },
          },
          include: { staffProfile: true },
        }),
      }),
    });
    revalidatePeople();
    return { userId: user.id };
  });
}

export async function updateStaff(userId: unknown, input: unknown) {
  return runAction(["staff", "update"], async (ctx) => {
    const id = idSchema.parse(userId);
    const data = staffSchema.parse(input);
    const audit = auditContextFor(ctx);
    const t = await getTranslations("people.errors");
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "User",
      run: async (tx) => {
        const before = await must(
          tx.user.findFirst({
            where: { id, tenantId: audit.tenantId, role: { in: [Role.SCHOOL_ADMIN, Role.ACCOUNTANT, Role.SCHOOL_NURSE] } },
            include: { staffProfile: true },
          }),
        );
        if (before.role === Role.SCHOOL_ADMIN && data.role !== Role.SCHOOL_ADMIN) {
          if (before.id === ctx.user.id) throw new UserFacingError(t("cannotDemoteSelf"), { role: t("cannotDemoteSelf") });
          await assertAnotherActiveAdmin(tx, audit.tenantId, before.id, t("lastAdmin"));
        }
        const profile = {
          employeeId: data.employeeId,
          designation: data.designation ?? null,
          department: data.department ?? null,
          ...(data.joiningDate ? { joiningDate: data.joiningDate } : {}),
        };
        const after = await tx.user.update({
          where: { id: before.id },
          data: {
            name: data.name,
            email: data.email,
            role: data.role,
            staffProfile: before.staffProfile
              ? { update: profile }
              : { create: { tenantId: audit.tenantId, ...profile } },
          },
          include: { staffProfile: true },
        });
        return { before, after };
      },
    });
    revalidatePeople();
  });
}

async function assertAnotherActiveAdmin(
  tx: Parameters<Parameters<typeof auditedMutation>[1]["run"]>[0],
  tenantId: string,
  excludingUserId: string,
  message: string,
) {
  const others = await tx.user.count({
    where: { tenantId, role: Role.SCHOOL_ADMIN, isActive: true, NOT: { id: excludingUserId } },
  });
  if (others === 0) throw new UserFacingError(message);
}

// -------------------------------------------------------------- guardians ---

export async function updateGuardian(userId: unknown, input: unknown) {
  return runAction(["guardian", "update"], async (ctx) => {
    const id = idSchema.parse(userId);
    const data = guardianSchema.parse(input);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "User",
      run: async (tx) => {
        const before = await must(
          tx.user.findFirst({ where: { id, tenantId: audit.tenantId, role: Role.PARENT }, include: { guardianProfile: true } }),
        );
        const after = await tx.user.update({
          where: { id: before.id },
          data: {
            name: data.name,
            email: data.email,
            guardianProfile: { update: { phone: data.phone ?? null, occupation: data.occupation ?? null } },
          },
          include: { guardianProfile: true },
        });
        return { before, after };
      },
    });
    revalidatePeople();
  });
}

// ------------------------------------------------------ account lifecycle ---

/** Deactivate = can't sign in, keeps all history. Reactivate reverses it. */
export async function setUserActive(userId: unknown, active: unknown) {
  return runAction(["user", "update"], async (ctx) => {
    const id = idSchema.parse(userId);
    const isActive = active === true;
    const audit = auditContextFor(ctx);
    const t = await getTranslations("people.errors");
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "User",
      run: async (tx) => {
        const before = await must(
          tx.user.findFirst({ where: { id, tenantId: audit.tenantId, role: { not: Role.PLATFORM_ADMIN } } }),
        );
        if (!isActive) {
          if (before.id === ctx.user.id) throw new UserFacingError(t("cannotDeactivateSelf"));
          if (before.role === Role.SCHOOL_ADMIN) await assertAnotherActiveAdmin(tx, audit.tenantId, before.id, t("lastAdmin"));
        }
        const after = await tx.user.update({ where: { id: before.id }, data: { isActive } });
        return { before, after };
      },
    });
    revalidatePeople();
  });
}

function appOrigin(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  if (host) return `${proto}://${host}`;
  return (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Sends (or re-sends) the "set your password" invite. The link is emailed
 * when email is configured; otherwise it's returned so the admin can pass it
 * on (WhatsApp, SMS…). Either way only a hash is stored and any earlier link
 * stops working.
 */
export async function sendInvite(userId: unknown) {
  return runAction(["user", "update"], async (ctx) => {
    // An invite link sets a password: support never mints one while signed in as a school admin.
    forbidWhileImpersonating(ctx);
    const id = idSchema.parse(userId);
    const audit = auditContextFor(ctx);
    const t = await getTranslations("people.invite");
    const te = await getTranslations("people.errors");

    const user = await must(
      ctx.db.user.findFirst({
        where: { id, tenantId: audit.tenantId, role: { not: Role.PLATFORM_ADMIN } },
        include: { tenant: { select: { name: true } } },
      }),
    );
    if (!user.isActive) throw new UserFacingError(te("inviteDeactivated"));
    if (user.passwordHash) throw new UserFacingError(te("alreadyActive"));

    const { token, tokenHash, expires } = generateInviteToken();
    // verification_tokens is a platform table (not readable by the tenant role), so the base client writes it.
    await prisma.$transaction([
      prisma.verificationToken.deleteMany({ where: { identifier: inviteIdentifier(user.id) } }),
      prisma.verificationToken.create({ data: { identifier: inviteIdentifier(user.id), token: tokenHash, expires } }),
    ]);

    const link = `${appOrigin()}/invite/${token}`;
    const school = user.tenant?.name ?? "EduCore";
    const result = isEmailConfigured()
      ? await sendEmail({
          to: user.email,
          subject: t("emailSubject", { school }),
          text: t("emailText", { name: user.name, school, link }),
          html: `<p>${escapeHtml(t("emailGreeting", { name: user.name }))}</p><p>${escapeHtml(
            t("emailBody", { school }),
          )}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t("emailButton"))}</a></p><p style="color:#666;font-size:13px">${escapeHtml(
            t("emailExpiry"),
          )}</p>`,
        })
      : ({ sent: false, reason: "not_configured" } as const);

    await recordAudit(audit, {
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      after: { invite: result.sent ? "emailed" : "link_created", expires: expires.toISOString() },
    });
    revalidatePeople();
    return { emailed: result.sent, link: result.sent ? null : link, email: user.email };
  });
}
