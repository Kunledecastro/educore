/**
 * Fixed-window rate limiter for auth endpoints (security requirement:
 * "Rate limiting on auth endpoints — Upstash Redis free tier or in-memory
 * fallback").
 *
 * - With UPSTASH_REDIS_REST_URL/TOKEN set: counters live in Upstash, shared
 *   by every serverless instance (the real protection in production).
 * - Without them: an in-memory Map per server instance. Still slows down a
 *   single-connection brute force, but instances don't share counts — set
 *   up Upstash before real schools go live (see DEPLOYMENT.md).
 *
 * Fail-open on limiter errors: if Upstash is down, sign-in keeps working
 * (password checks and argon2 cost still apply) and the error is logged.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms when the current window ends. */
  resetAt: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now, private readonly maxKeys = 10_000) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      if (this.windows.size >= this.maxKeys) this.sweep(t);
      w = { count: 0, resetAt: t + windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return { allowed: w.count <= limit, remaining: Math.max(0, limit - w.count), resetAt: w.resetAt };
  }

  private sweep(t: number) {
    for (const [k, w] of this.windows) if (w.resetAt <= t) this.windows.delete(k);
    // Still full of live windows: drop the oldest entries rather than grow without bound.
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}

export class UpstashRateLimiter implements RateLimiter {
  constructor(private readonly url: string, private readonly token: string) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const redisKey = `rl:${key}:${windowStart}`;
    const res = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["PEXPIRE", redisKey, String(windowMs), "NX"],
      ]),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash rate limit request failed: ${res.status}`);
    const [incr] = (await res.json()) as [{ result?: number; error?: string }, unknown];
    if (typeof incr?.result !== "number") throw new Error(`Upstash INCR failed: ${incr?.error ?? "unknown"}`);
    return { allowed: incr.result <= limit, remaining: Math.max(0, limit - incr.result), resetAt: windowStart + windowMs };
  }
}

let limiter: RateLimiter | undefined;

export function getRateLimiter(): RateLimiter {
  if (!limiter) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    limiter = url && token ? new UpstashRateLimiter(url, token) : new MemoryRateLimiter();
  }
  return limiter;
}

/** Login policy: per account+IP (targeted guessing) and per IP (spraying many accounts). */
export const LOGIN_LIMITS = {
  perAccount: { limit: 5, windowMs: 15 * 60_000 },
  perIp: { limit: 30, windowMs: 15 * 60_000 },
} as const;

/** True if this login attempt may proceed. Counts the attempt either way. */
export async function allowLoginAttempt(
  email: string,
  ip: string | null,
  rl: RateLimiter = getRateLimiter(),
): Promise<boolean> {
  const who = ip ?? "unknown-ip";
  try {
    const [account, perIp] = await Promise.all([
      rl.hit(`login:acct:${email.toLowerCase()}:${who}`, LOGIN_LIMITS.perAccount.limit, LOGIN_LIMITS.perAccount.windowMs),
      rl.hit(`login:ip:${who}`, LOGIN_LIMITS.perIp.limit, LOGIN_LIMITS.perIp.windowMs),
    ]);
    return account.allowed && perIp.allowed;
  } catch (err) {
    console.error("[rate-limit] limiter unavailable, allowing attempt", err);
    return true;
  }
}
