/**
 * Notification channels (Phase 4.4). One interface; in-app is the database
 * itself (unread counts, dashboard), email goes out through Resend once
 * RESEND_API_KEY and EMAIL_FROM are set, and SMS/WhatsApp can be added later
 * as another channel without touching the senders.
 *
 * Emails never carry the message itself (it may be about a child): they say
 * who wrote, about whom, and link back to EduCore, where access is checked.
 */

import { isInternalStudentEmail } from "../student-logins";

export interface OutgoingNotification {
  to: { email: string; name: string };
  subject: string;
  text: string;
  link: string;
}

export interface NotificationChannel {
  readonly name: "email" | "sms" | "whatsapp";
  enabled(): boolean;
  send(n: OutgoingNotification): Promise<void>;
}

export class ResendEmailChannel implements NotificationChannel {
  readonly name = "email" as const;
  constructor(private readonly env: Record<string, string | undefined> = process.env, private readonly fetchImpl: typeof fetch = fetch) {}

  enabled(): boolean {
    return Boolean(this.env.RESEND_API_KEY && this.env.EMAIL_FROM);
  }

  async send(n: OutgoingNotification): Promise<void> {
    // Students' accounts carry an internal address that must never be emailed.
    if (!this.enabled() || isInternalStudentEmail(n.to.email)) return;
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.env.EMAIL_FROM, to: [n.to.email], subject: n.subject, text: `${n.text}\n\n${n.link}\n` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend refused the email: ${res.status}`);
  }
}

export const CHANNELS: NotificationChannel[] = [new ResendEmailChannel()];

export function anyChannelEnabled(channels: NotificationChannel[] = CHANNELS): boolean {
  return channels.some((c) => c.enabled());
}

/** The email for "you have a new message". Exported for tests. */
export function newMessageEmail(input: { recipient: { email: string; name: string }; senderName: string; schoolName: string; subject: string; studentName: string | null; link: string }): OutgoingNotification {
  const about = input.studentName ? ` about ${input.studentName}` : "";
  return {
    to: input.recipient,
    subject: `New message from ${input.senderName}${about} — ${input.schoolName}`,
    text: `Hello ${input.recipient.name},\n\n${input.senderName} sent you a message${about} on EduCore (${input.schoolName}): "${input.subject}".\n\nSign in to read and reply:`,
    link: input.link,
  };
}
