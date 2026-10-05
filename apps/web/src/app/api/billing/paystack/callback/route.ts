import { NextResponse, type NextRequest } from "next/server";
import { settleSubscriptionPayment } from "@/lib/billing/subscription-billing";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/billing/paystack/callback?reference=ECB-… — where Paystack sends a
 * school admin after paying EduCore. Nothing in the URL is trusted: we ask
 * Paystack about the reference and settle it (idempotent; the webhook may
 * already have), then show "Plan & billing" with the outcome.
 */
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference") ?? req.nextUrl.searchParams.get("trxref") ?? "";
  const to = (status: string) => NextResponse.redirect(new URL(`/plan?billing=${status}`, req.nextUrl.origin), { status: 303 });
  try {
    const outcome = await settleSubscriptionPayment(reference);
    return to(outcome.result === "unknown" ? "unknown" : outcome.result);
  } catch (err) {
    console.error("[billing] callback could not settle", err);
    return to("checking");
  }
}
