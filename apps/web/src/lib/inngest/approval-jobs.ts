import { recipients, sweep } from "@/lib/approvals/engine";
import { approvalNeededEmail, approvalOutcomeEmail, CHANNELS } from "@/lib/notify/channels";
import { inngest } from "./client";
import { appUrl } from "./notify-message";

/**
 * Approval emails (Phase 8.0). In-app, the Approvals menu count and the
 * dashboard already show what's waiting; these send email once a channel is
 * set up: to the approvers when something needs them, to the requester when
 * it's decided.
 */
export const notifyApproval = inngest.createFunction(
  { id: "notify-approval", name: "Tell approvers / requesters about approvals", retries: 3, concurrency: { key: "event.data.tenantId", limit: 2 } },
  { event: "educore/approval.changed" },
  async ({ event, step }) => {
    const channels = CHANNELS.filter((c) => c.enabled());
    if (channels.length === 0) return { skipped: "no channel" };
    const { tenantId, requestId } = event.data;
    const who = event.data.event === "decided" ? "requester" : "approvers";
    const r = await step.run("load", () => recipients(tenantId, requestId, who));
    if (!r || r.to.length === 0) return { skipped: "no recipients" };
    for (const to of r.to) {
      await step.run(`send-${to.id}`, async () => {
        const link = `${appUrl()}/approvals/${requestId}`;
        const n =
          who === "requester"
            ? approvalOutcomeEmail({ recipient: { email: to.email, name: to.name }, process: r.process, status: r.status, schoolName: r.school, link })
            : approvalNeededEmail({ recipient: { email: to.email, name: to.name }, process: r.process, requester: r.requester, schoolName: r.school, reminder: false, link });
        for (const c of channels) await c.send(n);
      });
    }
    return { sent: r.to.length };
  },
);

/** Daily: expire requests nobody decided, and remind approvers of ones waiting two days or more. */
export const approvalSweep = inngest.createFunction(
  { id: "approval-sweep", name: "Expire and remind approvals", retries: 2 },
  [{ cron: "TZ=Africa/Lagos 0 7 * * *" }],
  async ({ step }) => {
    const out = await step.run("sweep", async () => {
      const s = await sweep();
      return { expired: s.expired, remind: s.remind };
    });
    const channels = CHANNELS.filter((c) => c.enabled());
    if (channels.length) {
      for (const e of out.expired) {
        await step.run(`expired-${e.id}`, async () => {
          const r = await recipients(e.tenantId, e.id, "requester");
          for (const to of r?.to ?? []) for (const c of channels) await c.send(approvalOutcomeEmail({ recipient: { email: to.email, name: to.name }, process: r!.process, status: "EXPIRED", schoolName: r!.school, link: `${appUrl()}/approvals/${e.id}` }));
        });
      }
      for (const x of out.remind) {
        await step.run(`remind-${x.id}`, async () => {
          const r = await recipients(x.tenantId, x.id, "approvers");
          for (const to of r?.to ?? []) for (const c of channels) await c.send(approvalNeededEmail({ recipient: { email: to.email, name: to.name }, process: r!.process, requester: r!.requester, schoolName: r!.school, reminder: true, link: `${appUrl()}/approvals/${x.id}` }));
        });
      }
    }
    return { expired: out.expired.length, reminded: out.remind.length };
  },
);
