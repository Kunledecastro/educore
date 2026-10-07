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

/** "Work was returned" / "marks are ready" (Phase 5.2). Never includes the score or comment. Exported for tests. */
export function workFeedbackEmail(input: { recipient: { email: string; name: string }; pupilName: string; title: string; schoolName: string; kind: "returned" | "released"; link: string }): OutgoingNotification {
  const subject =
    input.kind === "returned" ? `Work returned for corrections: ${input.title} (${input.pupilName}) — ${input.schoolName}` : `Marks ready: ${input.title} (${input.pupilName}) — ${input.schoolName}`;
  const body =
    input.kind === "returned"
      ? `The teacher has returned "${input.title}" to ${input.pupilName} with a comment on what to correct. It can be handed in again on EduCore.`
      : `The marks for "${input.title}" are ready for ${input.pupilName}.`;
  return { to: input.recipient, subject, text: `Hello ${input.recipient.name || "there"},\n\n${body}\n\nSign in to see it:`, link: input.link };
}

/** "Reset your password" (Phase 6.1). Exported for tests. */
export function passwordResetEmail(input: { recipient: { email: string; name: string }; link: string; minutes: number }): OutgoingNotification {
  return {
    to: input.recipient,
    subject: "Reset your EduCore password",
    text: `Hello ${input.recipient.name || "there"},\n\nSomeone (hopefully you) asked to reset the password for your EduCore account. The link below works once, for ${input.minutes} minutes.\n\nIf you didn't ask, ignore this email — your password won't change.\n\nReset your password:`,
    link: input.link,
  };
}

/**
 * "Your child visited the school clinic" (Phase 7.2). Never says why or what
 * was done — only that there was a visit, and whether it needs attention.
 * Exported for tests.
 */
export function clinicVisitEmail(input: { recipient: { email: string; name: string }; pupilName: string; schoolName: string; urgent: boolean; link: string }): OutgoingNotification {
  const subject = input.urgent ? `Please read: ${input.pupilName} visited the school clinic — ${input.schoolName}` : `${input.pupilName} visited the school clinic — ${input.schoolName}`;
  const body = input.urgent
    ? `${input.pupilName} visited the school clinic today and the school would like you to read the clinic's note as soon as you can. If the school needs you to come in, they will also call you.`
    : `${input.pupilName} visited the school clinic today. You can see what happened on EduCore.`;
  return { to: input.recipient, subject, text: `Hello ${input.recipient.name || "there"},\n\n${body}\n\nSign in to see it:`, link: input.link };
}
