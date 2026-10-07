import { runHealthRetention, visitRecipients } from "@/lib/health/visits";
import { CHANNELS, clinicVisitEmail } from "@/lib/notify/channels";
import { objectStore } from "@/lib/storage/object-store";
import { inngest } from "./client";
import { appUrl } from "./notify-message";

/**
 * Tells parents their child visited the clinic (Phase 7.2). In-app, the
 * Health page and dashboard already show it the moment it's saved; this
 * sends the email once a channel is set up. The email names the child only —
 * never the complaint or the care.
 */
export const notifyClinicVisit = inngest.createFunction(
  { id: "notify-clinic-visit", name: "Tell parents about a clinic visit", retries: 3, concurrency: { key: "event.data.tenantId", limit: 2 } },
  { event: "educore/clinic.visit" },
  async ({ event, step }) => {
    const channels = CHANNELS.filter((c) => c.enabled());
    if (channels.length === 0) return { skipped: "no channel" };
    const r = await step.run("load", () => visitRecipients(event.data.tenantId, event.data.visitId));
    if (!r || r.to.length === 0) return { skipped: "no recipients" };
    for (const to of r.to) {
      await step.run(`send-${to.id}`, async () => {
        const n = clinicVisitEmail({ recipient: { email: to.email, name: to.name }, pupilName: r.pupil, schoolName: r.school, urgent: r.urgent, link: `${appUrl()}/health/${r.studentId}` });
        for (const c of channels) await c.send(n);
      });
    }
    return { sent: r.to.length };
  },
);

/** Nightly: deletes health data of pupils who left longer ago than their school's retention period. */
export const healthRetention = inngest.createFunction(
  { id: "health-retention", name: "Delete expired health records", retries: 2 },
  [{ cron: "TZ=Africa/Lagos 45 3 * * *" }, { event: "educore/health.retention" }],
  async ({ step }) => {
    const r = await step.run("clean", async () => {
      const out = await runHealthRetention();
      return { keys: out.keys, done: out.done };
    });
    if (r.keys.length && objectStore.configured()) await step.run("remove-files", () => objectStore.remove(r.keys));
    return { schools: r.done.length, pupils: r.done.reduce((n, d) => n + d.pupils, 0), files: r.keys.length };
  },
);
