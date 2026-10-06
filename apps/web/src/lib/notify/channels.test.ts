import { describe, expect, it, vi } from "vitest";
import { newMessageEmail, ResendEmailChannel } from "./channels";

describe("email channel", () => {
  it("is off until both RESEND_API_KEY and EMAIL_FROM are set, and then sends nothing", async () => {
    const fetchImpl = vi.fn();
    const off = new ResendEmailChannel({ RESEND_API_KEY: "re_x" }, fetchImpl as never);
    expect(off.enabled()).toBe(false);
    await off.send({ to: { email: "a@b.c", name: "A" }, subject: "s", text: "t", link: "https://x" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends through Resend when set up", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const on = new ResendEmailChannel({ RESEND_API_KEY: "re_x", EMAIL_FROM: "EduCore <no-reply@educore.test>" }, fetchImpl as never);
    await on.send({ to: { email: "a@b.c", name: "A" }, subject: "Hi", text: "Body", link: "https://x/messages/1" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(init.body)).toMatchObject({ to: ["a@b.c"], subject: "Hi", from: "EduCore <no-reply@educore.test>" });
  });

  it("the message email names who and whom, never the message itself", () => {
    const n = newMessageEmail({ recipient: { email: "p@x.test", name: "Mrs Okonkwo" }, senderName: "Mr Eze", schoolName: "Greenfield", subject: "Homework", studentName: "Amaka", link: "https://app/messages/t1" });
    expect(n.subject).toBe("New message from Mr Eze about Amaka — Greenfield");
    expect(n.text).toContain('"Homework"');
    expect(n.link).toBe("https://app/messages/t1");
  });
});

describe("workFeedbackEmail", () => {
  it("names the work and the pupil, never the score or comment", async () => {
    const { workFeedbackEmail } = await import("./channels");
    const n = workFeedbackEmail({ recipient: { email: "mum@x.ng", name: "Mrs Okafor" }, pupilName: "Ada Okafor", title: "Fractions", schoolName: "Greenfield", kind: "returned", link: "https://x/assignments/1" });
    expect(n.subject).toBe("Work returned for corrections: Fractions (Ada Okafor) — Greenfield");
    expect(n.text).toContain("handed in again");
    const r = workFeedbackEmail({ recipient: { email: "a@x.ng", name: "" }, pupilName: "Ada", title: "Fractions", schoolName: "G", kind: "released", link: "l" });
    expect(r.subject).toBe("Marks ready: Fractions (Ada) — G");
    expect(r.text).toContain("Hello there");
  });
});
