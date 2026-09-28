import { EventSchemas, Inngest } from "inngest";

/**
 * Background jobs (architecture rule #7). Inngest calls back into
 * /api/inngest; requests are verified with INNGEST_SIGNING_KEY and events
 * are sent with INNGEST_EVENT_KEY (both set by the Vercel integration).
 */
type Events = {
  /** A validated import was confirmed by an admin. Sent only by our server. */
  "educore/import.requested": { data: { jobId: string; tenantId: string } };
};

export const inngest = new Inngest({ id: "educore", schemas: new EventSchemas().fromRecord<Events>() });
