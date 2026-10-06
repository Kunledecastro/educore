import { withRls } from "@educore/db";
import { cleanAbandonedUploads } from "@/lib/assignments/submissions";
import { CHANNELS, workFeedbackEmail } from "@/lib/notify/channels";
import { inngest } from "./client";
import { appUrl } from "./notify-message";

/**
 * Tells pupils and parents that work was returned for corrections or that
 * marks were shared (Phase 5.2). In-app, the assignment page and dashboard
 * already show it; this sends email once a channel is set up. The email
 * names the assignment and the pupil only — never the score or comment.
 */
export const notifyAssignmentFeedback = inngest.createFunction(
  { id: "notify-assignment-feedback", name: "Tell families about returned work / shared marks", retries: 3, concurrency: { key: "event.data.tenantId", limit: 2 } },
  { event: "educore/assignment.feedback" },
  async ({ event, step }) => {
    const { tenantId, assignmentId, studentIds, kind } = event.data;
    const channels = CHANNELS.filter((c) => c.enabled());
    if (channels.length === 0) return { skipped: "no channel" };

    const people = await step.run("load", () =>
      withRls(tenantId, async (tx) => {
        const a = await tx.assignment.findFirst({ where: { id: assignmentId, tenantId }, select: { title: true, tenant: { select: { name: true } } } });
        if (!a) return null;
        const pupils = await tx.student.findMany({
          where: { tenantId, id: { in: studentIds.slice(0, 200) }, status: "ACTIVE" },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            user: { select: { id: true, email: true, name: true, isActive: true } },
            guardians: { select: { guardian: { select: { user: { select: { id: true, email: true, name: true, isActive: true } } } } } },
          },
        });
        const to: { key: string; email: string; name: string; pupil: string }[] = [];
        for (const p of pupils) {
          const pupil = `${p.firstName} ${p.lastName}`;
          if (p.user?.isActive) to.push({ key: `${p.id}-${p.user.id}`, email: p.user.email, name: p.user.name ?? pupil, pupil });
          for (const g of p.guardians) {
            const u = g.guardian.user;
            if (u?.isActive) to.push({ key: `${p.id}-${u.id}`, email: u.email, name: u.name ?? "", pupil });
          }
        }
        return { title: a.title, school: a.tenant.name, to };
      }),
    );
    if (!people) return { skipped: "not found" };
    for (const r of people.to) {
      await step.run(`send-${r.key}`, async () => {
        const n = workFeedbackEmail({ recipient: { email: r.email, name: r.name }, pupilName: r.pupil, title: people.title, schoolName: people.school, kind, link: `${appUrl()}/assignments/${assignmentId}` });
        for (const c of channels) await c.send(n);
      });
    }
    return { sent: people.to.length };
  },
);

/** Every day: delete files that were uploaded but never handed in (over a day old). */
export const cleanUploads = inngest.createFunction(
  { id: "clean-abandoned-uploads", name: "Clean up abandoned uploads", retries: 2 },
  [{ cron: "TZ=Africa/Lagos 30 3 * * *" }],
  async ({ step }) => {
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const n = await step.run(`batch-${i}`, () => cleanAbandonedUploads());
      total += n;
      if (n < 200) break;
    }
    return { removed: total };
  },
);
