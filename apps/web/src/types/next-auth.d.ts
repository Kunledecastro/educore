import type { Role } from "@educore/db";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      tenantId: string | null;
    } & DefaultSession["user"];
    /** Phase 6: "pending" until this session passes the 2FA code step. */
    mfa: "ok" | "pending";
    /** Session version at sign-in; a mismatch means "signed out everywhere". -1 = a session from before Phase 6. */
    sv: number;
    sid: string;
  }

  interface User {
    role: Role;
    tenantId: string | null;
  }
}

// next-auth v5 re-exports JWT from @auth/core/jwt, so the augmentation must
// target that module directly — augmenting "next-auth/jwt" is silently a no-op.
declare module "@auth/core/jwt" {
  interface JWT {
    role: Role;
    tenantId: string | null;
    mfa?: "ok" | "pending";
    sv?: number;
    sid?: string;
  }
}
