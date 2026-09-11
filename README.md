# EduCore — Multi-Tenant School Management SaaS

EduCore is a multi-tenant School Management System: schools subscribe
per-student-per-month, and each school gets an isolated workspace (its own
subdomain, users, data, and branding) inside a single shared deployment.

This repo currently implements **Phase 0 — Foundation**. See
[CHANGELOG.md](./CHANGELOG.md) for what shipped and [DEPLOYMENT.md](./DEPLOYMENT.md)
for step-by-step free-tier deployment instructions.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui-style primitives, TanStack Query, React Hook Form + Zod |
| Backend | Next.js Route Handlers, TypeScript |
| Database | PostgreSQL (Supabase, free tier) + Prisma ORM |
| Auth | Auth.js (NextAuth v5) — credentials + optional Google/Microsoft OAuth, JWT sessions |
| i18n | next-intl (English + French seeded) |
| Monorepo | pnpm workspaces + Turborepo |
| Testing | Vitest (unit/integration), Playwright (e2e) |

## Monorepo layout

```
apps/web/            Next.js application (marketing site + tenant app)
packages/db/          Prisma schema, migrations, seed script, tenant-scoping
                       Prisma Client Extension, RLS helper, audit-log helper
packages/auth/        RBAC permission matrix (single source of truth),
                       password hashing, ORM-independent Role mirror
```

## Multi-tenancy & security model (architecture rule #1)

Two independent layers enforce tenant isolation, so a bug in one does not
break the other:

1. **Application layer** — `packages/db/src/tenant-scope.ts` exports
   `forTenant(tenantId)`, a Prisma Client Extension that transparently
   injects `tenantId` into every `where`/`data` clause for every
   tenant-owned model. Request-handling code never uses the bare `prisma`
   client directly — it calls `forTenant()` (via `requireUser()` in
   `apps/web/src/lib/guard.ts`) and gets back a client that literally
   cannot cross a tenant boundary by omission.
2. **Database layer** — `packages/db/prisma/migrations/0002_rls` enables
   PostgreSQL Row Level Security with `FORCE ROW LEVEL SECURITY` on every
   tenant-owned table, keyed on the session variable `app.tenant_id`. This
   protects against a bug in layer 1, a future service that talks to
   Postgres directly, or a hand-written raw query. See the **known
   limitation** below.

`PLATFORM_ADMIN` is the only role that operates *above* tenant isolation
(via `platformPrisma()`), and every platform-admin action must be paired
with an audit log entry.

**Known Phase 0 limitation** (stated explicitly rather than glossed over):
setting `app.tenant_id` safely on a pooled connection requires either a
dedicated connection per request or `SET LOCAL` inside a transaction — a
bare `SET` on a pgbouncer-pooled connection can leak context between
requests. `packages/db/src/rls.ts`'s `withRls()` helper does this correctly
and is used for background jobs / raw SQL; wiring it into every ordinary
ORM call (on top of the Prisma Client Extension, which already protects the
hot path) is tracked as Phase 1 work.

## RBAC

Roles: `PLATFORM_ADMIN`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`, `PARENT`,
`ACCOUNTANT`. The single source of truth is
`packages/auth/src/permissions.ts` (`PERMISSION_MATRIX` + `can()`), unit
tested in `packages/auth/src/permissions.test.ts`. Every role — including
`PLATFORM_ADMIN` — has **read-only** access to the audit log; nobody can
edit or delete an audit entry, by design.

## Local development

```bash
pnpm install                        # installs deps, generates Prisma client (postinstall)
cp .env.example .env                # fill in DATABASE_URL / DIRECT_URL / NEXTAUTH_SECRET
pnpm db:migrate                     # applies migrations to your database
pnpm db:seed                        # seeds demo data (Greenfield Academy)
pnpm dev                            # starts the Next.js app
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for how to get a free Postgres database
(Supabase or Neon) and the rest of the free-tier stack.

## Demo data & login

The seed script creates one demo school, **Greenfield Academy**, with the
2026/2027 academic year, 2 classes (Grade 5-A, Grade 6-A), 12 students, 3
teachers, 1 school admin, 1 parent, plus a platform admin. Every seeded user
shares the password `Passw0rd!23`.

| Role | Email |
|---|---|
| Platform admin | `platform.admin@educore.dev` |
| School admin | `admin@greenfield.edu` |
| Teacher | `c.eze@greenfield.edu` |
| Parent | `parent@example.com` |

## Tests

```bash
pnpm test          # Vitest — RBAC permission matrix, tenant-isolation, business logic
pnpm test:e2e       # Playwright — login + dashboard smoke tests
```

The tenant-isolation suite (`packages/db/tests/tenant-isolation.test.ts`) is
the most important test in this repo: it proves Tenant A cannot read or
write Tenant B's data through the scoped Prisma client.
