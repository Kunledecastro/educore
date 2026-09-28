import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, userAgentFromHeaders } from "./request-meta";

describe("clientIpFromHeaders", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
  });
  it("accepts IPv6", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });
  it("rejects junk instead of storing it", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "<script>, 1.2.3.4" }))).toBeNull();
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});

describe("userAgentFromHeaders", () => {
  it("truncates very long values", () => {
    expect(userAgentFromHeaders(new Headers({ "user-agent": "x".repeat(2000) }))).toHaveLength(512);
    expect(userAgentFromHeaders(new Headers())).toBeNull();
  });
});
