// Argon2id password hashing via @node-rs/argon2.
//
// Why not the `argon2` package: it relies on a node-gyp native build that
// Vercel's serverless bundle did not ship ("No native build was found for
// platform=linux ... node=24"), which crashed every auth route in production.
// @node-rs/argon2 ships prebuilt N-API binaries as per-platform optional
// dependencies, so it works on Vercel with no build step.
//
// Hashes are standard PHC strings ($argon2id$v=19$...), so hashes created by
// the old `argon2` package (all Phase 0 seed users) still verify — the
// parameters are read from the hash itself, not from the options below.
import { hash, verify } from "@node-rs/argon2";

// OWASP Password Storage Cheat Sheet baseline for argon2id:
// m=19 MiB, t=2, p=1. The algorithm defaults to Argon2id in @node-rs/argon2
// (its `Algorithm` export is a TS const enum, which isolatedModules forbids
// importing, so we rely on the default and assert it in passwords.test.ts).
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
