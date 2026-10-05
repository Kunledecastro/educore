import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paystack (milestone 3.3), behind a tiny provider interface so another
 * gateway (Flutterwave, Stripe) can be added per school later.
 *
 * Money is only ever considered received after `verify()` asks Paystack
 * directly, server to server. The browser redirect and the webhook are just
 * prompts to go and check. The secret key comes from PAYSTACK_SECRET_KEY
 * and never leaves the server.
 */

export interface CheckoutRequest {
  email: string;
  amountMinor: number; // kobo for NGN
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

export type VerifiedStatus = "success" | "failed" | "abandoned" | "pending";

export interface Verification {
  status: VerifiedStatus;
  amountMinor: number;
  currency: string;
  reference: string;
  paidAt: Date | null;
  channel: string | null;
  message: string | null;
  /** The card, when Paystack lets us charge it again (subscriptions, 4.2). Never sent to a browser. */
  authorization?: SavedCard | null;
  customerCode?: string | null;
  /** The email Paystack holds the card under — saved-card charges must use it. */
  customerEmail?: string | null;
}

export interface SavedCard {
  code: string;
  brand: string | null;
  last4: string | null;
  /** "MM/YYYY" */
  expiry: string | null;
}

export interface ChargeRequest {
  authorizationCode: string;
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  metadata: Record<string, string>;
}

export interface PaymentProvider {
  name: "paystack";
  configured(): boolean;
  /** Starts a hosted checkout; returns the URL to send the payer to. */
  initialize(req: CheckoutRequest): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<Verification>;
  /** Charges a saved card (subscription renewals, 4.2). Returns the transaction as Paystack sees it. */
  chargeAuthorization(req: ChargeRequest): Promise<Verification>;
  /** True if a webhook body really came from the provider. */
  verifySignature(rawBody: string, signature: string | null): boolean;
}

/** Currencies Paystack can charge in. */
export const PAYSTACK_CURRENCIES = new Set(["NGN", "GHS", "ZAR", "KES", "USD"]);

export class PaymentProviderError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

const API = "https://api.paystack.co";

function secret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new PaymentProviderError("PAYSTACK_SECRET_KEY is not set");
  return key;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: unknown } | null;
  if (!res.ok || !body?.status) throw new PaymentProviderError(body?.message ?? `Paystack ${res.status}`, res.status);
  return body.data as T;
}

/** Paystack's verify `data` → our shape. Exported for tests. */
export function parseVerification(data: {
  status?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  paid_at?: string | null;
  channel?: string | null;
  gateway_response?: string | null;
  authorization?: { authorization_code?: string; reusable?: boolean; brand?: string; card_type?: string; last4?: string; exp_month?: string; exp_year?: string } | null;
  customer?: { customer_code?: string; email?: string } | null;
}): Verification {
  const a = data.authorization;
  const card: SavedCard | null =
    a?.reusable === true && typeof a.authorization_code === "string" && /^AUTH_[A-Za-z0-9]+$/.test(a.authorization_code)
      ? {
          code: a.authorization_code,
          brand: (a.brand ?? a.card_type ?? null)?.trim().slice(0, 30) || null,
          last4: /^\d{4}$/.test(a.last4 ?? "") ? a.last4! : null,
          expiry: /^\d{1,2}$/.test(a.exp_month ?? "") && /^\d{4}$/.test(a.exp_year ?? "") ? `${a.exp_month!.padStart(2, "0")}/${a.exp_year}` : null,
        }
      : null;
  const known: VerifiedStatus[] = ["success", "failed", "abandoned"];
  const status = known.includes(data.status as VerifiedStatus) ? (data.status as VerifiedStatus) : "pending";
  return {
    status,
    amountMinor: Number.isInteger(data.amount) ? (data.amount as number) : -1,
    currency: String(data.currency ?? "").toUpperCase(),
    reference: String(data.reference ?? ""),
    paidAt: data.paid_at ? new Date(data.paid_at) : null,
    channel: data.channel ?? null,
    message: data.gateway_response ?? null,
    authorization: card,
    customerCode: typeof data.customer?.customer_code === "string" ? data.customer.customer_code : null,
    customerEmail: typeof data.customer?.email === "string" && data.customer.email.includes("@") ? data.customer.email.slice(0, 254) : null,
  };
}

/** HMAC-SHA512 of the raw body with the secret key, compared in constant time. Exported for tests. */
export function signatureMatches(rawBody: string, signature: string | null, key: string): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", key).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const paystack: PaymentProvider = {
  name: "paystack",
  configured: () => Boolean(process.env.PAYSTACK_SECRET_KEY),
  async initialize(req) {
    const data = await call<{ authorization_url: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: req.email,
        amount: req.amountMinor,
        currency: req.currency,
        reference: req.reference,
        callback_url: req.callbackUrl,
        metadata: req.metadata,
      }),
    });
    if (!data?.authorization_url?.startsWith("https://")) throw new PaymentProviderError("Paystack returned no checkout URL");
    return { authorizationUrl: data.authorization_url };
  },
  async verify(reference) {
    return parseVerification(await call(`/transaction/verify/${encodeURIComponent(reference)}`));
  },
  async chargeAuthorization(req) {
    return parseVerification(
      await call("/transaction/charge_authorization", {
        method: "POST",
        body: JSON.stringify({
          authorization_code: req.authorizationCode,
          email: req.email,
          amount: req.amountMinor,
          currency: req.currency,
          reference: req.reference,
          metadata: req.metadata,
        }),
      }),
    );
  },
  verifySignature(rawBody, signature) {
    const key = process.env.PAYSTACK_SECRET_KEY;
    return Boolean(key) && signatureMatches(rawBody, signature, key!);
  },
};
