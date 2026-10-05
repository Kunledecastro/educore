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
};

export const inngest = new Inngest({ id: "educore", schemas: new EventSchemas().fromRecord<Events>() });
