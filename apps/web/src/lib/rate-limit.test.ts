import { describe, expect, it } from "vitest";
import { allowLoginAttempt, LOGIN_LIMITS, MemoryRateLimiter, type RateLimiter } from "./rate-limit";

describe("MemoryRateLimiter", () => {
  it("allows up to the limit, then blocks until the window resets", async () => {
    let now = 0;
    const rl = new MemoryRateLimiter(() => now);
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rl.hit("k", 3, 1000)).allowed);
    expect(results).toEqual([true, true, true, false]);
    now = 1000;
    expect((await rl.hit("k", 3, 1000)).allowed).toBe(true);
  });

  it("keeps keys independent", async () => {
    const rl = new MemoryRateLimiter(() => 0);
    await rl.hit("a", 1, 1000);
    expect((await rl.hit("a", 1, 1000)).allowed).toBe(false);
    expect((await rl.hit("b", 1, 1000)).allowed).toBe(true);
  });

  it("never grows beyond maxKeys", async () => {
    const rl = new MemoryRateLimiter(() => 0, 100);
    for (let i = 0; i < 1000; i++) await rl.hit(`k${i}`, 5, 60_000);
    // @ts-expect-error — peeking at the private map in a test
    expect(rl.windows.size).toBeLessThanOrEqual(100);
  });
});

describe("allowLoginAttempt", () => {
  it("blocks the 6th attempt on one account from one IP", async () => {
    const rl = new MemoryRateLimiter(() => 0);
    const outcomes = [];
    for (let i = 0; i < LOGIN_LIMITS.perAccount.limit + 1; i++) {
      outcomes.push(await allowLoginAttempt("Admin@Greenfield.edu", "203.0.113.7", rl));
    }
    expect(outcomes.slice(0, LOGIN_LIMITS.perAccount.limit).every(Boolean)).toBe(true);
    expect(outcomes.at(-1)).toBe(false);
  });

  it("treats email case-insensitively", async () => {
    const rl = new MemoryRateLimiter(() => 0);
    for (let i = 0; i < LOGIN_LIMITS.perAccount.limit; i++) await allowLoginAttempt("a@b.co", "1.1.1.1", rl);
    expect(await allowLoginAttempt("A@B.CO", "1.1.1.1", rl)).toBe(false);
  });

  it("blocks an IP spraying many different accounts", async () => {
    const rl = new MemoryRateLimiter(() => 0);
    let last = true;
    for (let i = 0; i <= LOGIN_LIMITS.perIp.limit; i++) last = await allowLoginAttempt(`user${i}@x.co`, "9.9.9.9", rl);
    expect(last).toBe(false);
  });

  it("fails open if the limiter itself errors", async () => {
    const broken: RateLimiter = { hit: async () => { throw new Error("redis down"); } };
    const origError = console.error;
    console.error = () => {};
    try {
      expect(await allowLoginAttempt("a@b.co", "1.1.1.1", broken)).toBe(true);
    } finally {
      console.error = origError;
    }
  });
});
