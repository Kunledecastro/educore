import { randomBytes } from "node:crypto";
import { platformPrisma, recordAudit, recordPlatformAudit, type PrismaClient } from "@educore/db";
import { DEFAULT_PLANS, type PlanCode } from "../entitlements";
import { loadEntitlements, toPlanRow, type PlanRow } from "../entitlements-data";
import { paystack, type PaymentProvider, type Verification } from "../payments/paystack";
import { decideSettlement } from "../payments/settle-rules";
import { addMonths, checkoutPeriodStart, isRenewalDue, monthlyQuote, nextRetryAt, planAction, type PlanAction } from "./rules";

/**
 * EduCore's own subscription billing (Phase 4.2), through Paystack in naira.
 *
 * - Checkout: the school admin pays the first (or overdue) month on Paystack's
 *   page; the card is saved as a reusable authorization.
 * - Renewal: a daily job charges the saved card for active students × price.
 * - Money is only ever counted after Paystack confirms it server to server;
 *   settlement locks the payment row and is idempotent (return page, webhook
 *   and the job can all arrive — the first records it).
 *
 * Plans, subscriptions and EduCore invoices are platform tables: this module
 * uses the platform client, and every query is filtered by the school's id.
 * No request APIs here, so the background job can use it.
 */

const REF = /^ECB-[0-9a-f]{20}$/;
const SYSTEM = { actorId: null, ipAddress: null, userAgent: "EduCore billing" };

export function newBillingReference(): string {
  return `ECB-${randomBytes(10).toString("hex")}`;
}

export type BillingErrorCode = "planNotForSale" | "notConfigured" | "schoolNotActive" | "nothingToChange" | "notPaying";

export class BillingError extends Error {
  constructor(public readonly code: BillingErrorCode) {
    super(code);
    this.name = "BillingError";
  }
}

/** Who did it, for both audit logs. */
export interface BillingActor {
  id: string;
  email: string;
  ipAddress: string | null;
  userAgent: string | null;
  impersonatorId?: string | null;
}

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

async function planRow(db: Pick<Tx, "planDefinition">, code: PlanCode): Promise<PlanRow> {
  const row = await db.planDefinition.findUnique({ where: { code } });
  return row ? toPlanRow(row) : { ...DEFAULT_PLANS[code], name: code, isPublic: code !== "FREE_TRIAL", updatedAt: null };
}

const forSale = (p: PlanRow) => p.isPublic && p.code !== "FREE_TRIAL" && p.priceMinor > 0;

/** What a checkout for `plan` would charge right now, and for which month. */
export async function quoteCheckout(tenantId: string, code: PlanCode, now: Date = new Date()) {
  const db = platformPrisma();
  const [plan, e, sub, active] = await Promise.all([
    planRow(db, code),
    loadEntitlements(tenantId, now),
    db.subscription.findUnique({ where: { tenantId }, select: { currentPeriodEnd: true } }),
    db.student.count({ where: { tenantId, status: "ACTIVE" } }),
  ]);
  const periodStart = checkoutPeriodStart(e, sub?.currentPeriodEnd ?? null, now);
  return { plan, periodStart, periodEnd: addMonths(periodStart, 1), ...monthlyQuote(plan, active) };
}

/**
 * Starts a Paystack checkout for a month of `plan`. Records the invoice and
 * the attempt FIRST (so the webhook can find it), then asks for the page.
 * Any unpaid EduCore invoice is replaced: a school only ever owes one.
 */
export async function startSubscriptionCheckout(
  input: { tenantId: string; actor: BillingActor; plan: PlanCode; callbackUrl: (reference: string) => string },
  provider: PaymentProvider = paystack,
  now: Date = new Date(),
) {
  if (!provider.configured()) throw new BillingError("notConfigured");
  const db = platformPrisma();
  const tenant = await db.tenant.findUnique({ where: { id: input.tenantId }, select: { status: true, name: true } });
  if (!tenant || tenant.status !== "ACTIVE") throw new BillingError("schoolNotActive");
  const q = await quoteCheckout(input.tenantId, input.plan, now);
  if (!forSale(q.plan)) throw new BillingError("planNotForSale");

  const reference = newBillingReference();
  const { invoice, payment } = await db.$transaction(async (tx) => {
    // Serialise with the renewal job and with a second click.
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${input.tenantId} FOR UPDATE`;
    await tx.platformInvoice.updateMany({ where: { tenantId: input.tenantId, status: "OPEN" }, data: { status: "VOID" } });
    const invoice = await tx.platformInvoice.create({
      data: {
        tenantId: input.tenantId,
        plan: q.plan.code,
        periodStart: q.periodStart,
        periodEnd: q.periodEnd,
        students: q.students,
        unitPriceMinor: q.unitPriceMinor,
        amountMinor: q.amountMinor,
        createdById: input.actor.id,
      },
    });
    const payment = await tx.platformPayment.create({
      data: { tenantId: input.tenantId, invoiceId: invoice.id, reference, kind: "CHECKOUT", amountMinor: q.amountMinor, initiatedById: input.actor.id },
    });
    await recordPlatformAudit(
      { actorId: input.actor.impersonatorId ?? input.actor.id, ipAddress: input.actor.ipAddress, userAgent: input.actor.userAgent },
      { action: "SUBSCRIPTION_CHECKOUT", tenantId: input.tenantId, entityType: "PlatformInvoice", entityId: invoice.id, after: { number: invoice.number, plan: invoice.plan, amountMinor: invoice.amountMinor, reference } },
      tx,
    );
    return { invoice, payment };
  });

  try {
    const { authorizationUrl } = await provider.initialize({
      email: input.actor.email,
      amountMinor: q.amountMinor,
      currency: invoice.currency,
      reference,
      callbackUrl: input.callbackUrl(reference),
      metadata: { purpose: "educore-subscription", invoice: invoice.number, school: input.tenantId },
    });
    return { reference, authorizationUrl, invoiceNumber: invoice.number, amountMinor: q.amountMinor };
  } catch (err) {
    await db.platformPayment.update({ where: { id: payment.id }, data: { status: "FAILED", message: "Could not start checkout" } });
    throw err;
  }
}

export type BillingOutcome =
  | { result: "unknown" }
  | { result: "paid" | "pending" | "failed" | "abandoned" | "review"; invoiceNumber: string };

/**
 * Applies what Paystack says about a reference. Pass `given` when the
 * transaction details are already in hand (a saved-card charge returns them).
 */
export async function settleSubscriptionPayment(reference: string, provider: PaymentProvider = paystack, given?: Verification, now: Date = new Date()): Promise<BillingOutcome> {
  if (!REF.test(reference)) return { result: "unknown" };
  const db = platformPrisma();
  const found = await db.platformPayment.findUnique({ where: { reference }, select: { id: true } });
  if (!found) return { result: "unknown" };
  const v = given ?? (await provider.verify(reference));

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM platform_payments WHERE reference = ${reference} FOR UPDATE`;
    const p = await tx.platformPayment.findUniqueOrThrow({ where: { reference }, include: { invoice: true } });
    const invoiceNumber = p.invoice.number;
    const decision = decideSettlement({ status: p.status, amountMinor: p.amountMinor, currency: p.currency, reference }, v);

    if (decision.action === "none") {
      const map = { SUCCEEDED: "paid", PENDING: "pending", FAILED: "failed", ABANDONED: "abandoned", NEEDS_REVIEW: "review" } as const;
      return { result: map[p.status], invoiceNumber };
    }
    if (decision.action === "mark") {
      await tx.platformPayment.update({ where: { id: p.id }, data: { status: decision.status, message: v.message?.slice(0, 200) ?? null, verifiedAt: now } });
      if (p.kind === "RENEWAL" && decision.status === "FAILED") await renewalFailed(tx, p.tenantId, v.message, now);
      return { result: decision.status === "FAILED" ? "failed" : "abandoned", invoiceNumber };
    }
    if (decision.action === "review" || p.invoice.status !== "OPEN") {
      // Paid, but not for exactly what we asked, or for an invoice replaced meanwhile: the platform team decides (refund or apply).
      const reason = decision.action === "review" ? decision.reason : "invoiceNotOpen";
      await tx.platformPayment.update({ where: { id: p.id }, data: { status: "NEEDS_REVIEW", message: reason, channel: v.channel, verifiedAt: now } });
      await recordPlatformAudit(SYSTEM, { action: "SUBSCRIPTION_PAYMENT_REVIEW", tenantId: p.tenantId, entityType: "PlatformPayment", entityId: p.id, after: { reference, reason, amountMinor: v.amountMinor } }, tx);
      return { result: "review", invoiceNumber };
    }

    // The money is in.
    const paidAt = v.paidAt ?? now;
    await tx.platformPayment.update({ where: { id: p.id }, data: { status: "SUCCEEDED", channel: v.channel, message: v.message?.slice(0, 200) ?? null, verifiedAt: now } });
    await tx.platformInvoice.update({ where: { id: p.invoiceId }, data: { status: "PAID", paidAt } });
    const before = await tx.subscription.findUnique({ where: { tenantId: p.tenantId } });
    const card = v.authorization
      ? { paystackAuthorizationCode: v.authorization.code, cardBrand: v.authorization.brand, cardLast4: v.authorization.last4, cardExpiry: v.authorization.expiry }
      : {};
    const next = {
      plan: p.invoice.plan,
      status: "ACTIVE" as const,
      currentPeriodEnd: p.invoice.periodEnd,
      failedAttempts: 0,
      nextChargeAt: null,
      lastChargeError: null,
      ...(p.kind === "CHECKOUT" ? { cancelAtPeriodEnd: false, pendingPlan: null } : {}),
      ...card,
      ...(v.customerCode ? { paystackCustomerCode: v.customerCode } : {}),
      ...(v.customerEmail ? { billingEmail: v.customerEmail } : {}),
    };
    await tx.subscription.upsert({ where: { tenantId: p.tenantId }, create: { tenantId: p.tenantId, ...next }, update: next });
    await tx.tenant.update({ where: { id: p.tenantId }, data: { plan: p.invoice.plan } });

    const snap = { plan: p.invoice.plan, paidUntil: p.invoice.periodEnd, invoice: invoiceNumber, amountMinor: p.amountMinor, card: v.authorization?.last4 ?? before?.cardLast4 ?? null };
    const beforeSnap = before ? { plan: before.plan, status: before.status, paidUntil: before.currentPeriodEnd } : null;
    await recordPlatformAudit(SYSTEM, { action: "SUBSCRIPTION_PAID", tenantId: p.tenantId, entityType: "PlatformInvoice", entityId: p.invoiceId, before: beforeSnap, after: snap }, tx);
    await recordAudit({ tenantId: p.tenantId, actorId: p.initiatedById, ipAddress: null, userAgent: SYSTEM.userAgent }, { action: "UPDATE", entityType: "Subscription", entityId: p.tenantId, before: beforeSnap, after: snap }, tx);
    return { result: "paid", invoiceNumber };
  });
}

async function renewalFailed(tx: Tx, tenantId: string, message: string | null, now: Date) {
  const sub = await tx.subscription.findUnique({ where: { tenantId } });
  if (!sub?.currentPeriodEnd) return;
  const failedAttempts = sub.failedAttempts + 1;
  const after = await tx.subscription.update({
    where: { tenantId },
    data: { status: "PAST_DUE", failedAttempts, nextChargeAt: nextRetryAt(sub.currentPeriodEnd, failedAttempts), lastChargeError: message?.slice(0, 200) ?? "Declined" },
  });
  await recordPlatformAudit(SYSTEM, {
    action: "SUBSCRIPTION_PAYMENT_FAILED",
    tenantId,
    entityType: "Subscription",
    entityId: tenantId,
    after: { failedAttempts, nextChargeAt: after.nextChargeAt, message: after.lastChargeError, at: now },
  }, tx);
}

/** Schools whose saved card should be charged now. */
export async function dueRenewals(now: Date = new Date()): Promise<string[]> {
  const subs = await platformPrisma().subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "PAST_DUE"] },
      cancelAtPeriodEnd: false,
      paystackAuthorizationCode: { not: null },
      currentPeriodEnd: { lte: now },
      tenant: { status: "ACTIVE", plan: { not: "FREE_TRIAL" } },
    },
    select: { tenantId: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, failedAttempts: true, nextChargeAt: true },
  });
  return subs.filter((s) => isRenewalDue({ ...s, hasCard: true }, now)).map((s) => s.tenantId);
}

/**
 * Charges one school's saved card for its next month. Safe to run twice:
 * the subscription row is locked while preparing, a month is invoiced once
 * (unique index), and a renewal still waiting for an answer is checked
 * instead of charged again.
 */
export async function chargeRenewal(tenantId: string, provider: PaymentProvider = paystack, now: Date = new Date()): Promise<BillingOutcome | { result: "notDue" }> {
  const db = platformPrisma();
  const prepared = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE "tenantId" = ${tenantId} FOR UPDATE`;
    const sub = await tx.subscription.findUnique({ where: { tenantId }, include: { tenant: { select: { plan: true, status: true } } } });
    if (!sub || sub.tenant.status !== "ACTIVE" || !sub.paystackAuthorizationCode || !sub.billingEmail) return null;
    if (!isRenewalDue({ ...sub, hasCard: true }, now)) return null;

    const code = (sub.pendingPlan ?? sub.tenant.plan) as PlanCode;
    if (code === "FREE_TRIAL") return null;
    const plan = await planRow(tx, code);
    if (plan.priceMinor <= 0) return null;
    const periodStart = sub.currentPeriodEnd!;

    let invoice = await tx.platformInvoice.findFirst({ where: { tenantId, periodStart, status: { not: "VOID" } }, include: { payments: { where: { status: "PENDING" } } } });
    if (invoice?.status === "PAID") return null; // paid another way (checkout); the subscription already moved on
    // A renewal still waiting for Paystack's answer: ask about it rather than charging again.
    const waiting = invoice?.payments[0];
    if (waiting) return { kind: "verify" as const, reference: waiting.reference };

    // The scheduled downgrade takes effect with the new month.
    if (sub.pendingPlan) {
      await tx.tenant.update({ where: { id: tenantId }, data: { plan: sub.pendingPlan } });
      await tx.subscription.update({ where: { tenantId }, data: { plan: sub.pendingPlan, pendingPlan: null } });
      await recordPlatformAudit(SYSTEM, { action: "SUBSCRIPTION_DOWNGRADED", tenantId, entityType: "Subscription", entityId: tenantId, before: { plan: sub.tenant.plan }, after: { plan: sub.pendingPlan } }, tx);
    }

    const q = monthlyQuote(plan, await tx.student.count({ where: { tenantId, status: "ACTIVE" } }));
    if (invoice && (invoice.amountMinor !== q.amountMinor || invoice.plan !== code)) {
      await tx.platformInvoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
      invoice = null;
    }
    const inv =
      invoice ??
      (await tx.platformInvoice.create({
        data: { tenantId, plan: code, periodStart, periodEnd: addMonths(periodStart, 1), students: q.students, unitPriceMinor: q.unitPriceMinor, amountMinor: q.amountMinor },
      }));
    const reference = newBillingReference();
    await tx.platformPayment.create({ data: { tenantId, invoiceId: inv.id, reference, kind: "RENEWAL", amountMinor: inv.amountMinor } });
    const charge = { reference, amountMinor: inv.amountMinor, currency: inv.currency, invoiceNumber: inv.number, email: sub.billingEmail, authorizationCode: sub.paystackAuthorizationCode };
    return { kind: "charge" as const, charge };
  });

  if (!prepared) return { result: "notDue" };
  if (prepared.kind === "verify") return settleSubscriptionPayment(prepared.reference, provider, undefined, now);

  const c = prepared.charge;
  let v: Verification;
  try {
    v = await provider.chargeAuthorization({
      authorizationCode: c.authorizationCode,
      email: c.email,
      amountMinor: c.amountMinor,
      currency: c.currency,
      reference: c.reference,
      metadata: { purpose: "educore-subscription", invoice: c.invoiceNumber, school: tenantId },
    });
  } catch (err) {
    // We don't know whether the card was charged: ask Paystack. If that fails too, the attempt stays
    // pending and the next run (or the webhook) checks it — never a blind second charge.
    console.error("[billing] saved-card charge did not answer", err);
    try {
      v = await provider.verify(c.reference);
    } catch {
      return { result: "pending", invoiceNumber: c.invoiceNumber };
    }
  }
  return settleSubscriptionPayment(c.reference, provider, v, now);
}

/** Subscriptions set to stop at the end of the month: once it ends, they're cancelled (the school goes read-only). */
export async function closeCancelled(now: Date = new Date()): Promise<number> {
  const db = platformPrisma();
  const ending = await db.subscription.findMany({
    where: { cancelAtPeriodEnd: true, status: { in: ["ACTIVE", "PAST_DUE"] }, currentPeriodEnd: { lte: now } },
    select: { tenantId: true },
  });
  for (const { tenantId } of ending) {
    await db.$transaction(async (tx) => {
      await tx.subscription.update({ where: { tenantId }, data: { status: "CANCELLED" } });
      await recordPlatformAudit(SYSTEM, { action: "SUBSCRIPTION_ENDED", tenantId, entityType: "Subscription", entityId: tenantId, after: { status: "CANCELLED" } }, tx);
    });
  }
  return ending.length;
}

/**
 * A paying school changes plan: upgrades now (new price from the next
 * charge), downgrades at renewal. Anything else needs a checkout first
 * (returns "checkout" without changing anything).
 */
export async function changePlan(tenantId: string, code: PlanCode, actor: BillingActor, now: Date = new Date()): Promise<PlanAction> {
  const db = platformPrisma();
  const [target, e] = await Promise.all([planRow(db, code), loadEntitlements(tenantId, now)]);
  if (!forSale(target)) throw new BillingError("planNotForSale");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { plan: true, subscription: true } });
    const sub = tenant.subscription;
    const current = await planRow(tx, tenant.plan as PlanCode);
    const action = planAction({ state: e.state, hasCard: Boolean(sub?.paystackAuthorizationCode), current, target, pendingPlan: sub?.pendingPlan ?? null });
    if (action === "checkout") return action;
    if (action === "none") throw new BillingError("nothingToChange");

    const before = { plan: tenant.plan, pendingPlan: sub?.pendingPlan ?? null };
    let after: { plan: string; pendingPlan: string | null };
    if (action === "switchNow") {
      await tx.tenant.update({ where: { id: tenantId }, data: { plan: code } });
      await tx.subscription.update({ where: { tenantId }, data: { plan: code, pendingPlan: null } });
      after = { plan: code, pendingPlan: null };
    } else if (action === "scheduleDowngrade") {
      await tx.subscription.update({ where: { tenantId }, data: { pendingPlan: code } });
      after = { plan: tenant.plan, pendingPlan: code };
    } else {
      await tx.subscription.update({ where: { tenantId }, data: { pendingPlan: null } });
      after = { plan: tenant.plan, pendingPlan: null };
    }
    await recordPlatformAudit({ actorId: actor.impersonatorId ?? actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: "SUBSCRIPTION_PLAN_CHANGE", tenantId, entityType: "Subscription", entityId: tenantId, before, after: { ...after, how: action } }, tx);
    await recordAudit({ tenantId, actorId: actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent, impersonatorId: actor.impersonatorId ?? null }, { action: "UPDATE", entityType: "Subscription", entityId: tenantId, before, after }, tx);
    return action;
  });
}

/** Turn automatic monthly payment off (the plan stops at the end of the paid month) or back on. */
export async function setAutoRenew(tenantId: string, on: boolean, actor: BillingActor): Promise<void> {
  await platformPrisma().$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { tenantId } });
    if (!sub || !["ACTIVE", "PAST_DUE"].includes(sub.status) || !sub.paystackAuthorizationCode) throw new BillingError("notPaying");
    if (sub.cancelAtPeriodEnd === !on) return;
    await tx.subscription.update({ where: { tenantId }, data: { cancelAtPeriodEnd: !on } });
    const before = { autoRenew: !sub.cancelAtPeriodEnd };
    const after = { autoRenew: on, paidUntil: sub.currentPeriodEnd };
    await recordPlatformAudit({ actorId: actor.impersonatorId ?? actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: on ? "SUBSCRIPTION_RESUMED" : "SUBSCRIPTION_CANCELLED", tenantId, entityType: "Subscription", entityId: tenantId, before, after }, tx);
    await recordAudit({ tenantId, actorId: actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent, impersonatorId: actor.impersonatorId ?? null }, { action: "UPDATE", entityType: "Subscription", entityId: tenantId, before, after }, tx);
  });
}

/** What the school's billing page shows. Never includes the card token. */
export async function loadBilling(tenantId: string) {
  const db = platformPrisma();
  const [sub, invoices] = await Promise.all([
    db.subscription.findUnique({
      where: { tenantId },
      select: {
        plan: true,
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        pendingPlan: true,
        billingEmail: true,
        cardBrand: true,
        cardLast4: true,
        cardExpiry: true,
        failedAttempts: true,
        nextChargeAt: true,
        lastChargeError: true,
        paystackAuthorizationCode: true,
      },
    }),
    db.platformInvoice.findMany({
      where: { tenantId, status: { not: "VOID" } },
      orderBy: { periodStart: "desc" },
      take: 24,
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, channel: true, reference: true } } },
    }),
  ]);
  const { paystackAuthorizationCode, ...safe } = sub ?? ({} as NonNullable<typeof sub>);
  return { subscription: sub ? { ...safe, hasCard: Boolean(paystackAuthorizationCode) } : null, invoices };
}
