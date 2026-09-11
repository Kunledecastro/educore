import type { Role } from "@educore/db";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      tenantId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    tenantId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    tenantId: string | null;
  }
}
