import { EventSchemas, Inngest } from "inngest";

/**
 * Background jobs (architecture rule #7). Inngest calls back into
 * /api/inngest; requests are verified with INNGEST_SIGNING_KEY and events
 * are sent with INNGEST_EVENT_KEY (both set by the Vercel integration).
 */
type Events = {
  /** A validated import was confirmed by an admin. Sent only by our server. */
  "educore/import.requested": { data: { jobId: string; tenantId: string } };
  /** An admin asked to generate a section's report cards. Sent only by our server. */
  "educore/report-cards.requested": { data: { runId: string; tenantId: string } };
  /** A bursar/admin started billing a term for some classes. Sent only by our server. */
  "educore/billing.requested": { data: { runId: string; tenantId: string } };
  /** Run subscription renewals now (platform team, or Inngest dashboard). Sent only by our server. */
  "educore/subscriptions.renew": { data: Record<string, never> };
  /** Someone wrote in a conversation; tell the others (if a channel is set up). Sent only by our server. */
  "educore/message.sent": { data: { tenantId: string; threadId: string; messageId: string; recipientIds: string[] } };
  /** A teacher returned work for corrections or released marks; tell the families (if a channel is set up). Sent only by our server. */
  "educore/assignment.feedback": { data: { tenantId: string; assignmentId: string; studentIds: string[]; kind: "returned" | "released" } };
  /** The nurse recorded a clinic visit (or set an urgent outcome); tell the parents by email if a channel is set up. Sent only by our server. */
  "educore/clinic.visit": { data: { tenantId: string; visitId: string } };
  /** An approval request was made, moved to its next step, or decided (Phase 8): tell the right people by email. Sent only by our server. */
  "educore/approval.changed": { data: { tenantId: string; requestId: string; event: "requested" | "nextStep" | "decided" } };
  /** Run the health retention clean-up now (it also runs nightly). */
  "educore/health.retention": { data: Record<string, never> };
};

export const inngest = new Inngest({ id: "educore", schemas: new EventSchemas().fromRecord<Events>() });
