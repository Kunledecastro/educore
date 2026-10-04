import { NextResponse, type NextRequest } from "next/server";
import { settleOnlinePayment } from "@/lib/payments/online";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/payments/paystack/callback?reference=EDU-… — where Paystack sends
 * the parent after checkout. We don't trust anything in the URL: we ask
 * Paystack about the reference ourselves and settle it (idempotent; the
 * webhook may already have done it), then show the invoice with the outcome.
 */
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference") ?? req.nextUrl.searchParams.get("trxref") ?? "";
  const to = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin), { status: 303 });
  try {
    const outcome = await settleOnlinePayment(reference);
    if (outcome.result === "unknown") return to("/fees?online=unknown");
    return to(`/fees/invoices/${outcome.invoiceId}?online=${outcome.result}`);
  } catch (err) {
    // Paystack unreachable, say: the webhook (or a later check) will settle it.
    console.error("[paystack] callback could not settle", err);
    return to("/fees?online=checking");
  }
}
