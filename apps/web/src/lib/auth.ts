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

/** Too many attempts. The code reaches the login form so it can show a specific message. */
class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

export const { handlers, auth, signIn, signOut } = NextAuth({
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
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Checked before any database lookup or password hashing, so a
        // flood of attempts costs us almost nothing.
        if (!(await allowLoginAttempt(email, clientIpFromHeaders(request.headers)))) {
          throw new RateLimitedSignin();
        }

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          include: { tenant: true },
        });
        if (!user || !user.isActive || !user.passwordHash) return null;

        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) return null;

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
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.tenantId = user.tenantId;
      } else if (token.email && token.role === undefined) {
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
      return session;
    },
  },
});
