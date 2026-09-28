import "server-only";

/**
 * Transactional email behind a tiny interface, so the provider can change
 * (Resend today; Postmark or SMS/WhatsApp channels later) without touching
 * callers. Uses Resend's HTTP API directly — no SDK dependency.
 *
 * Without RESEND_API_KEY, nothing is sent and callers get
 * `{ sent: false, reason: "not_configured" }` — e.g. the invite flow then
 * shows the admin a link to copy instead.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailResult = { sent: true; id?: string } | { sent: false; reason: "not_configured" | "provider_error" };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[email] Resend rejected the message", res.status, await res.text().catch(() => ""));
      return { sent: false, reason: "provider_error" };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: body.id };
  } catch (err) {
    console.error("[email] Resend request failed", err);
    return { sent: false, reason: "provider_error" };
  }
}

/** Minimal HTML escaping for values interpolated into email bodies. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
