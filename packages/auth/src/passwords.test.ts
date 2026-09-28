import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords";

// Guards the migration to @node-rs/argon2: existing users must still log in.
// LEGACY: produced by the previous `argon2` (node-gyp) package's defaults.
// SEEDED: the exact hash format stored for the demo users in Supabase
// (params written m,p,t rather than m,t,p — both must verify).
const LEGACY_HASHES_OF_DEMO_PASSWORD = [
  "$argon2id$v=19$m=65536,t=3,p=4$1KvXEDG3/rbT/3+/jk49cQ$EJOTZaPlekvuXkt2rrCnvtQp+IaWnanHi3ieaAiQzAE",
  "$argon2id$v=19$m=65536,p=4,t=3$+g6AMx50obWoOpxtW0uXPg$dc+UT2nqtwTUhaYMCszpV4bgQJ2+c3iFetfLHZ/Brjk",
];

describe("password hashing", () => {
  it("produces argon2id PHC hashes", async () => {
    const hashed = await hashPassword("correct horse battery staple");
    expect(hashed.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const hashed = await hashPassword("s3cret-Pa55");
    expect(await verifyPassword(hashed, "s3cret-Pa55")).toBe(true);
    expect(await verifyPassword(hashed, "s3cret-Pa56")).toBe(false);
  });

  it("uses a fresh salt for every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it.each(LEGACY_HASHES_OF_DEMO_PASSWORD)("still verifies existing hash %s", async (legacy) => {
    expect(await verifyPassword(legacy, "Passw0rd!23")).toBe(true);
    expect(await verifyPassword(legacy, "wrong")).toBe(false);
  });

  it("returns false (not throw) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });
});
