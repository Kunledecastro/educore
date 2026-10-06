-- Phase 6: two-factor sign-in and password resets. Additive.

-- On users (not secret): whether 2FA is on (shown to admins), and a version
-- that, when bumped, signs the account out on every device.
ALTER TABLE "users" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- The secrets, kept apart from the users table and out of the app role's reach
-- (only the platform/server client reads them, at sign-in and in settings).
CREATE TABLE "user_security" (
    "userId" TEXT NOT NULL,
    "totpSecretEnc" TEXT,
    "pendingSecretEnc" TEXT,
    "pendingCreatedAt" TIMESTAMP(3),
    "backupCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastUsedStep" BIGINT,
    "enabledAt" TIMESTAMP(3),
    "twoFactorVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_security_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "user_security_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_security_codes" CHECK (cardinality("backupCodeHashes") <= 10)
);

-- Forgot-password links (6.1): only a hash of the token is stored.
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

ALTER TABLE "user_security" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_security" FORCE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE ALL ON "user_security", "password_reset_tokens" FROM educore_app;
  END IF;
END $$;
