import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { prisma, Role } from "@educore/db";
import { verifyPassword } from "@educore/auth";
import { isLoginAllowed, loginHostFromHeaders } from "./login-guard";
import { allowLoginAttempt } from "./rate-limit";
import { clientIpFromHeaders } from "./request-meta";
import { studentUsername } from "./student-logins";
import { studentMayUseLogin } from "./student-logins-data";
import { REMEMBER_COOKIE, tokenAfterUpdate, tokenAtSignIn } from "./security/session-state";
import { securityState } from "./security/two-factor";

/** The "remember this device" cookie, if the request has one (sign-in runs inside a request). */
async function rememberCookie(): Promise<string | undefined> {
  try {
    const { cookies } = await import("next/headers");
    return cookies().get(REMEMBER_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

/** Too many attempts. The code reaches the login form so it can show a specific message. */
class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Students (Phase 5.0): school short name + admission number instead of an email. */
const studentCredentialsSchema = z.object({
  school: z.string().trim().min(3).max(30),
  admissionNo: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});

const oauthProviders = [];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  oauthProviders.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}
if (process.env.MICROSOFT_ENTRA_ID_CLIENT_ID && process.env.MICROSOFT_ENTRA_ID_CLIENT_SECRET) {
  oauthProviders.push(
    MicrosoftEntraID({
      clientId: process.env.MICROSOFT_ENTRA_ID_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_ENTRA_ID_CLIENT_SECRET,
      issuer: process.env.MICROSOFT_ENTRA_ID_ISSUER,
    }),
  );
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  // PrismaAdapter persists Users/Accounts for OAuth sign-in linking, but the
  // *session itself* is still a signed JWT (spec requirement) — the adapter
  // is not used for session storage. See the ASSUMPTION note in
  // packages/db/prisma/schema.prisma re: globally-unique email.
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, request) {
        // Staff and parents sign in with their email; students with school short name + admission number.
        const asStudent = studentCredentialsSchema.safeParse(raw);
        const asEmail = asStudent.success ? null : credentialsSchema.safeParse(raw);
        if (!asStudent.success && !asEmail?.success) return null;
        const password = asStudent.success ? asStudent.data.password : asEmail!.data!.password;
        const loginKey = asStudent.success ? studentUsername(asStudent.data.school, asStudent.data.admissionNo) : asEmail!.data!.email;

        // Checked before any database lookup or password hashing, so a
        // flood of attempts costs us almost nothing.
        if (!(await allowLoginAttempt(loginKey, clientIpFromHeaders(request.headers)))) {
          throw new RateLimitedSignin();
        }

        const user = asStudent.success
          ? await prisma.user.findUnique({ where: { username: loginKey }, include: { tenant: true } })
          : await prisma.user.findUnique({ where: { email: loginKey.toLowerCase() }, include: { tenant: true } });
        if (!user || !user.isActive || !user.passwordHash) return null;
        // A student account can only be used through the student sign-in, and staff never through it.
        if (asStudent.success !== (user.role === Role.STUDENT)) return null;

        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) return null;

        // Students: their class must (still) have logins switched on.
        if (user.role === Role.STUDENT && !(await studentMayUseLogin(user.id)).ok) return null;

        // Cross-tenant login guard — the school comes from the request host
        // (set by middleware), never from client input. See login-guard.ts.
        const allowed = isLoginAllowed(
          { isPlatformAdmin: user.role === Role.PLATFORM_ADMIN, tenant: user.tenant },
          loginHostFromHeaders(request.headers),
        );
        if (!allowed) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          tenantId: user.tenantId,
        };
      },
    }),
    ...oauthProviders,
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Credentials already fully validated in authorize(). For OAuth, only
      // allow sign-in for pre-provisioned, active accounts. OAuth never creates
      // accounts: schools sign up with a password (/signup) and invite their staff.
      if (account?.provider === "credentials") return true;
      if (!user.email) return false;
      const existing = await prisma.user.findUnique({ where: { email: user.email } });
      return Boolean(existing?.isActive);
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = user.role;
        token.tenantId = user.tenantId;
        // Phase 6: a fresh session id, the account's session version, and whether
        // the code step is still needed (2FA on and this device not remembered).
        const state = user.id ? await securityState(user.id) : null;
        const facts = state ? { userId: state.id, twoFactorEnabled: state.twoFactorEnabled, twoFactorVersion: state.twoFactorVersion, sessionVersion: state.sessionVersion } : null;
        return { ...token, ...tokenAtSignIn(facts, await rememberCookie()) };
      }
      if (trigger === "update") {
        // Only our server can mint a valid proof (after a correct code); anything else a browser sends is ignored.
        return tokenAfterUpdate(token, session, async () => (await securityState(token.sub!))?.sessionVersion ?? null);
      }
      if (token.email && token.role === undefined) {
        const dbUser = await prisma.user.findUnique({ where: { email: token.email } });
        if (dbUser) {
          token.sub = dbUser.id;
          token.role = dbUser.role;
          token.tenantId = dbUser.tenantId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role;
        session.user.tenantId = token.tenantId;
      }
      session.mfa = token.mfa ?? "ok";
      session.sv = token.sv ?? -1;
      session.sid = token.sid ?? "";
      return session;
    },
  },
});
