import { describe, expect, it } from "vitest";
import { signImpersonationToken, verifyImpersonationToken } from "./impersonation-token";

const secret = "test-secret";
const now = new Date("2026-10-05T12:00:00Z");
const in30 = new Date("2026-10-05T12:30:00Z");

describe("impersonation token", () => {
  it("round-trips a genuine, unexpired token", () => {
    const token = signImpersonationToken("cmabc123def456", in30, secret);
    expect(verifyImpersonationToken(token, secret, now)).toBe("cmabc123def456");
  });

  it("refuses expired tokens", () => {
    const token = signImpersonationToken("cmabc123def456", in30, secret);
    expect(verifyImpersonationToken(token, secret, new Date("2026-10-05T12:30:00Z"))).toBeNull();
  });

  it("refuses tampering: another session id, a later expiry, another key", () => {
    const token = signImpersonationToken("cmabc123def456", in30, secret);
    const [, exp, sig] = token.split(".");
    expect(verifyImpersonationToken(`cmOTHER00000000.${exp}.${sig}`, secret, now)).toBeNull();
    expect(verifyImpersonationToken(`cmabc123def456.${Number(exp) + 3600}.${sig}`, secret, now)).toBeNull();
    expect(verifyImpersonationToken(token, "another-secret", now)).toBeNull();
  });

  it("refuses junk", () => {
    for (const bad of [null, undefined, "", "a.b", "a.b.c.d", "x".repeat(300), "cmabc123def456.123.!!!"]) {
      expect(verifyImpersonationToken(bad, secret, now)).toBeNull();
    }
  });
});
