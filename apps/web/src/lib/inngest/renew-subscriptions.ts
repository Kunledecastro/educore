import { chargeRenewal, closeCancelled, dueRenewals } from "@/lib/billing/subscription-billing";
import { inngest } from "./client";

/**
 * EduCore subscription renewals (Phase 4.2), every morning at 06:00 Lagos.
 * Ends subscriptions set not to renew, then charges each school whose paid
 * month is over (or whose retry is due) on its saved card. Each school is its
 * own step, so one failure doesn't stop the rest and a retried run doesn't
 * repeat schools already done; chargeRenewal() itself never charges twice.
 */
export const renewSubscriptions = inngest.createFunction(
  { id: "renew-subscriptions", name: "Renew EduCore subscriptions", concurrency: { limit: 1 }, retries: 2 },
  [{ cron: "TZ=Africa/Lagos 0 6 * * *" }, { event: "educore/subscriptions.renew" }],
  async ({ step }) => {
    const ended = await step.run("close-cancelled", () => closeCancelled());
    const due = await step.run("find-due", () => dueRenewals());
    const results: Record<string, string> = {};
    for (const tenantId of due) {
      results[tenantId] = await step.run(`charge-${tenantId}`, async () => (await chargeRenewal(tenantId)).result);
    }
    return { ended, charged: due.length, results };
  },
);
