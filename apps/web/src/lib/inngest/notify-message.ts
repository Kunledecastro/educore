import { withRls } from "@educore/db";
import { CHANNELS, newMessageEmail } from "@/lib/notify/channels";
import { inngest } from "./client";

export function appUrl(): string {
  const explicit = process.env.NEXTAUTH_URL;
  if (explicit && !explicit.includes("localhost")) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return (explicit ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Tells the other people in a conversation that a message arrived (Phase
 * 4.4, rule #7: notifications run as background jobs). Sent only when a
 * channel (email) is set up; the message text itself is never sent out.
 * Recipients are re-checked as current participants of that thread.
 */
export const notifyMessage = inngest.createFunction(
  { id: "notify-message", name: "Notify about a new message", retries: 3, concurrency: { key: "event.data.tenantId", limit: 2 } },
  { event: "educore/message.sent" },
  async ({ event, step }) => {
    const { tenantId, threadId, messageId, recipientIds } = event.data;
    const channels = CHANNELS.filter((c) => c.enabled());
    if (channels.length === 0) return { skipped: "no channel" };

    const details = await step.run("load", () =>
      withRls(tenantId, async (tx) => {
        const message = await tx.message.findFirst({
          where: { id: messageId, threadId, tenantId },
          select: {
            sender: { select: { name: true } },
            thread: { select: { subject: true, student: { select: { firstName: true, lastName: true } }, participants: { where: { userId: { in: recipientIds } }, select: { user: { select: { id: true, email: true, name: true, isActive: true } } } } } },
            tenant: { select: { name: true } },
          },
        });
        if (!message) return null;
        return {
          sender: message.sender.name ?? "",
          school: message.tenant.name,
          subject: message.thread.subject,
          student: message.thread.student ? `${message.thread.student.firstName} ${message.thread.student.lastName}` : null,
          to: message.thread.participants.map((p) => p.user).filter((u) => u.isActive).map((u) => ({ id: u.id, email: u.email, name: u.name ?? "" })),
        };
      }),
    );
    if (!details) return { skipped: "not found" };

    for (const r of details.to) {
      await step.run(`send-${r.id}`, async () => {
        const n = newMessageEmail({ recipient: { email: r.email, name: r.name }, senderName: details.sender, schoolName: details.school, subject: details.subject, studentName: details.student, link: `${appUrl()}/messages/${threadId}` });
        for (const c of channels) await c.send(n);
      });
    }
    return { sent: details.to.length };
  },
);
