# DEPLOYMENT.md — Free-tier deployment (Vercel + Supabase)

This is the exact, step-by-step path to get EduCore Phase 0 live for **$0**.

## Current status

- ✅ **Database provisioned and ready.** A real Supabase project
  (`educore-greenfield`, ref `ghvltgumkwtpdzdgfxio`, `eu-west-1`) has already
  been created under your Supabase organization, migrated (schema +
  Row Level Security), and seeded with the Greenfield Academy demo data.
- ⏳ **App not yet deployed to Vercel.** The automated deploy hit
  `403: You don't have permission to create a project` on your Vercel
  account/team — that's a permission on the Vercel integration this
  assistant used, not something fixable from here. Follow the manual steps
  below (takes ~5 minutes) to finish deployment yourself.

## 1. Get your Supabase connection strings

1. Go to the [Supabase dashboard](https://supabase.com/dashboard/project/ghvltgumkwtpdzdgfxio) → your `educore-greenfield` project.
2. **Project Settings → Database.** Under "Connection string", copy:
   - **Connection pooling** string (port `6543`, `?pgbouncer=true`) → this is your `DATABASE_URL`.
   - **Direct connection** string (port `5432`) → this is your `DIRECT_URL`.
3. If you don't already have the database password, click **Reset database password** on that same page and use the new one in both strings above (only you can do this — it's not something that can be retrieved externally).

They'll look like:
```
DATABASE_URL="postgresql://postgres:<password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:<password>@db.ghvltgumkwtpdzdgfxio.supabase.co:5432/postgres"
```

## 2. Generate a NextAuth secret

```bash
openssl rand -base64 32
```
Save this as `NEXTAUTH_SECRET`.

## 3. Create the Vercel project

1. Push this repo to a GitHub repository (or use `vercel` CLI to deploy directly — either works).
2. In the [Vercel dashboard](https://vercel.com/new), import the repo.
3. **Root Directory:** `apps/web` (this is a monorepo — Vercel must build from the app, not the repo root).
4. **Framework Preset:** Next.js (auto-detected).
5. **Install / Build commands:** leave the defaults. The root `package.json`'s
   `postinstall` script (`pnpm --filter @educore/db run generate`) runs
   automatically after install and generates the Prisma client before
   `next build` runs — no custom build command needed as long as the
   env vars below are set *before* the first deploy.

## 4. Set environment variables (Vercel → Project Settings → Environment Variables)

| Variable | Value |
|---|---|
| `DATABASE_URL` | pooled connection string from step 1 |
| `DIRECT_URL` | direct connection string from step 1 |
| `NEXTAUTH_SECRET` | value from step 2 |
| `NEXTAUTH_URL` | your Vercel deployment URL, e.g. `https://educore.vercel.app` (you can set this after the first deploy assigns a URL, then redeploy) |
| `NEXT_PUBLIC_ROOT_DOMAIN` | `educore.vercel.app` (or your custom domain) — used by tenant subdomain resolution |

Everything else in `.env.example` (Stripe, Resend, R2/Storage, Inngest,
Upstash, OAuth) is optional for Phase 0 — the app runs fine without them;
those features come online in later phases.

## 5. Deploy

Click **Deploy**. Vercel will install dependencies, run `postinstall`
(Prisma generate), and build the Next.js app. The database is already
migrated and seeded, so the app should come up straight away against real
data.

## 6. Verify it's live

1. Open the deployed URL. You should see the EduCore marketing page.
2. Go to `/login` and sign in as `admin@greenfield.edu` / `Passw0rd!23` — you
   should land on the School Admin dashboard showing Greenfield Academy's
   real enrollment/attendance/fee numbers.
3. Tenant subdomain routing: a request to `greenfield.<your-root-domain>`
   resolves to the Greenfield Academy tenant via `middleware.ts` — set up a
   wildcard DNS/domain in Vercel (`*.educore.vercel.app` isn't supported on
   `vercel.app` subdomains without a custom domain, so this step needs your
   own domain once you're past the free `*.vercel.app` URL for multi-tenant
   subdomain testing).

## Notes on the two-layer tenant isolation in production

- RLS is enabled with `FORCE ROW LEVEL SECURITY` on every tenant-owned
  table. Confirm your Supabase connection role is **not** a Postgres
  superuser (Supabase's default `postgres` role is not), otherwise RLS is
  silently bypassed regardless of `FORCE`.
- The pooled connection (port 6543, pgbouncer) is what the app uses for
  ordinary requests — tenant isolation there is enforced by the Prisma
  Client Extension (`forTenant()`), not by session-level RLS variables
  (see the "known limitation" in README.md). The direct connection
  (`DIRECT_URL`) is used only for `prisma migrate`.

## Other free-tier services (later phases)

| Service | Free tier | Env vars |
|---|---|---|
| Resend (email) | 100 emails/day | `RESEND_API_KEY`, `EMAIL_FROM` |
| Stripe (payments, test mode) | free | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` |
| Cloudflare R2 (file storage) | 10GB free | `STORAGE_*` |
| Inngest (background jobs) | free tier | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` |
| Upstash Redis (rate limiting) | free tier | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (omit to fall back to in-memory) |
| Sentry (error monitoring) | free tier | `SENTRY_DSN` |

None of these block a Phase 0 deploy — they're documented in
`.env.example` for when the corresponding feature is built.
