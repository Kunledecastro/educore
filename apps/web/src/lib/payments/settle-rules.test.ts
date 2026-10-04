import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { parseVerification, signatureMatches } from "./paystack";
import { checkOnlineAmount, decideSettlement } from "./settle-rules";

const attempt = { status: "PENDING" as const, amountMinor: 5000000, currency: "NGN", reference: "EDU-abc" };
const v = (over: Partial<ReturnType<typeof parseVerification>> = {}) => ({
  status: "success" as const, amountMinor: 5000000, currency: "NGN", reference: "EDU-abc", paidAt: new Date(), channel: "card", message: "Approved", ...over,
});

describe("decideSettlement", () => {
  it("records a successful payment for exactly the amount asked", () => {
    expect(decideSettlement(attempt, v())).toEqual({ action: "record" });
  });
  it("never records twice", () => {
    expect(decideSettlement({ ...attempt, status: "SUCCEEDED" }, v())).toEqual({ action: "none" });
    expect(decideSettlement({ ...attempt, status: "NEEDS_REVIEW" }, v())).toEqual({ action: "none" });
  });
  it("sends anything that doesn't match to a person instead of recording it", () => {
    expect(decideSettlement(attempt, v({ amountMinor: 4999999 }))).toEqual({ action: "review", reason: "amountMismatch" });
    expect(decideSettlement(attempt, v({ currency: "USD" }))).toEqual({ action: "review", reason: "currencyMismatch" });
    expect(decideSettlement(attempt, v({ reference: "EDU-other" }))).toEqual({ action: "review", reason: "referenceMismatch" });
  });
  it("marks failures and abandoned checkouts, and waits on pending ones", () => {
    expect(decideSettlement(attempt, v({ status: "failed" }))).toEqual({ action: "mark", status: "FAILED" });
    expect(decideSettlement(attempt, v({ status: "abandoned" }))).toEqual({ action: "mark", status: "ABANDONED" });
    expect(decideSettlement(attempt, v({ status: "pending" }))).toEqual({ action: "none" });
  });
  it("a checkout first abandoned can still succeed later", () => {
    expect(decideSettlement({ ...attempt, status: "ABANDONED" }, v())).toEqual({ action: "record" });
  });
});

describe("checkOnlineAmount", () => {
  it("accepts part or full payment of the balance", () => {
    expect(checkOnlineAmount(5000000, 10000000)).toBeNull();
    expect(checkOnlineAmount(10000000, 10000000)).toBeNull();
    expect(checkOnlineAmount(5000, 5000)).toBeNull(); // a balance under ₦100 can be cleared
  });
  it("refuses more than the balance, tiny amounts and junk", () => {
    expect(checkOnlineAmount(10000001, 10000000)).toBe("moreThanBalance");
    expect(checkOnlineAmount(5000, 10000000)).toBe("tooSmall");
    expect(checkOnlineAmount(null, 100)).toBe("invalid");
    expect(checkOnlineAmount(0, 100)).toBe("invalid");
  });
});

describe("Paystack helpers", () => {
  it("verifies webhook signatures (HMAC-SHA512 of the raw body)", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "EDU-abc" } });
    const good = createHmac("sha512", "sk_test_x").update(body).digest("hex");
    expect(signatureMatches(body, good, "sk_test_x")).toBe(true);
    expect(signatureMatches(body, good, "sk_test_other")).toBe(false);
    expect(signatureMatches(body + " ", good, "sk_test_x")).toBe(false);
    expect(signatureMatches(body, null, "sk_test_x")).toBe(false);
    expect(signatureMatches(body, "abc", "sk_test_x")).toBe(false);
  });
  it("reads Paystack's verify response defensively", () => {
    expect(parseVerification({ status: "success", amount: 5000000, currency: "ngn", reference: "R", paid_at: "2026-10-04T08:00:00Z", channel: "card", gateway_response: "Approved" })).toMatchObject({
      status: "success", amountMinor: 5000000, currency: "NGN", reference: "R", channel: "card",
    });
    expect(parseVerification({ status: "ongoing", amount: 1.5 })).toMatchObject({ status: "pending", amountMinor: -1 });
  });
});
