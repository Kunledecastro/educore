import { NextResponse, type NextRequest } from "next/server";
import { settleOnlinePayment } from "@/lib/payments/online";
import { paystack } from "@/lib/payments/paystack";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/webhooks/paystack — Paystack's server-to-server notification.
 *
 * 1. The body must carry a valid HMAC-SHA512 signature (x-paystack-signature)
 *    made with our secret key; anything else is refused with 401.
 * 2. Even then we don't take the body's word for it: settleOnlinePayment()
 *    asks Paystack about the reference before any money is recorded.
 * 3. Idempotent: Paystack retries until it gets a 200, and a payment already
 *    settled by the return page is simply found settled.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 100_000 || !paystack.verifySignature(raw, req.headers.get("x-paystack-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (event.event === "charge.success" && typeof event.data?.reference === "string") {
    try {
      await settleOnlinePayment(event.data.reference);
    } catch (err) {
      console.error("[paystack] webhook could not settle", err);
      return NextResponse.json({ error: "Try again" }, { status: 500 }); // Paystack will retry
    }
  }
  return NextResponse.json({ ok: true });
}
