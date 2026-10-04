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
packages/ui/          Design-system primitives (shadcn/ui-style): button,
                       input, select, table, dialog, alert-dialog, dropdown,
                       empty state, skeleton. Presentational only.
```

## Building a feature: the conventions

- **List pages** are Server Components driven by the URL: parse
  `searchParams` with `parseListParams()` (`apps/web/src/lib/list-params.ts`,
  which whitelists sort columns and filter values), then render
  `ListToolbar` + `ListSearch` / `ListFilter` + `SortableHeader` +
  `ListPagination` from `components/list/`, an `EmptyState` when there are
  no rows, and a `loading.tsx` with `TableSkeleton`. See `/audit-log`.
- **Money, numbers, dates** always go through `lib/format.ts`
  (`formatMoney`, `formatDate`, `formatDateTime`, `todayInTimeZone`) with
  the school's settings from `getSettingsForUser()` — never `toLocaleString()`
  or a hard-coded `₦`. School settings are validated by
  `lib/tenant-settings.ts` and fall back to safe defaults field by field.
- **Server Actions** return `ActionResult` (`lib/action-result.ts`) — never
  throw expected errors. Destructive actions use `ConfirmAction`.
- **Changes to audited data** go through `auditedMutation()`
  (`packages/db/src/audit.ts`) with `auditContextFor(ctx)` from
  `lib/guard.ts`: the change and its audit entry commit in one RLS-bound
  transaction, and secrets (`passwordHash`, tokens) are redacted from the
  before/after snapshots.
- **Forms** use React Hook Form + Zod with `FormField`
  (`components/form/form-field.tsx`), which wires labels, hints, inline
  errors and `aria-*` attributes.
- **CSV imports** live in `apps/web/src/lib/imports/`: an `Importer` (see
  `types.ts`) only validates one row and writes one row; the engine does
  parsing (UTF-8/Windows-1252, `,`/`;`), header aliases, limits, in-file
  duplicates, per-row SAVEPOINTs and auditing. Upload = validate only
  (`/imports` → report); confirming sends `educore/import.requested` to
  Inngest, which imports in batches of 50 (`lib/inngest/run-import.ts`).
  Imports upsert on natural keys, so re-importing never duplicates.
- **Exports** (`/api/exports/{students|staff|parents}`) use the list page's
  filters and row scope, and the same column names as the import templates.
- **Onboarding checklist** (`lib/onboarding.ts`, pure + unit-tested): steps
  are computed from counts gathered in `lib/onboarding-data.ts`, never
  ticked by hand. To add a step: add its id, done-rule, prerequisites and
  links there, plus `onboarding.steps.<id>` text in both message files.
- **Grading and terms**: never compute a total, grade or current term
  inline — use `lib/grading.ts` (`gradeFor`, `roundScore`, validators) and
  `lib/current-term.ts` / `lib/terms.ts`. Score components are
  `AssessmentType` rows whose `weight` is marks out of 100.
- **Attendance**: rules (edit window, rate, what a save changes) are in
  `lib/attendance.ts`; who may take which register is
  `registerSectionIdsFor` / `loadRegisterSection` in
  `lib/attendance-data.ts` — use them for any new attendance screen or
  export. Write attendance only through `saveRegister` (audits each change).
- **Scores & results**: totals, grades, averages and positions come only
  from `lib/results.ts` (pure) via `lib/gradebook.ts` (one gradebook) and
  `lib/class-results.ts` (a class's term results — also for report cards).
  Families may only see a term that has a `ResultPublication` row. Write
  scores only through `saveScores` (audited, refuses published terms).
- **Report cards**: a card's contents are frozen into `ReportCard.snapshot`
  (versioned, `lib/report-card.ts`) by the `generate-report-cards` Inngest
  function; PDFs are drawn from snapshots (`lib/report-card-pdf.tsx`, Noto
  Sans in `assets/fonts`). Never render a card from live data. Families may
  only download when the class's term results are published.
- **Timetable**: clash and bell-schedule rules are in `lib/timetable.ts`;
  the database enforces the same slot rules (migration 0013), so map a
  unique-violation (P2002) on save to "just booked by someone else".
- **Money**: never use floats or `parseFloat` for amounts. Parse with
  `toMinor()` and compute in integer minor units (kobo/cents) with
  `lib/fees.ts`; store with `fromMinor()`; display with `formatMoney()`.
  What a student is billed for a term comes only from `computeBill()` via
  `billsFor()` (`lib/fees-data.ts`) — the bill preview, the billing preview
  and the background billing run all use it.
- **Invoices and payments** are written only through `lib/invoice-writer.ts`
  (`createInvoice`, `recordPayment`, `reversePayment`, `cancelInvoice`,
  `addAdjustment`) inside the school's RLS transaction: it locks the invoice
  row, issues gap-free numbers from `number_sequences`, recomputes
  `amountPaid`/status from the payments and writes the audit entry. Rules are
  pure in `lib/invoicing.ts`. Payments are append-only in the database (the
  app role has no UPDATE/DELETE): a mistake is undone with a reversal row.
  OVERDUE is derived (`displayStatus`), never stored.
- **Online payments** (`lib/payments/`): `startOnlineCheckout` records the
  attempt, then sends the parent to Paystack; money is applied ONLY by
  `settleOnlinePayment(reference)`, which asks Paystack server-to-server and
  is idempotent (the return page, the signed webhook and "check again" can
  all call it). Rules are pure in `settle-rules.ts`. Anything that doesn't
  match exactly — or arrives after the invoice was settled — becomes
  NEEDS_REVIEW for the bursar instead of being applied.
- **Every string** is in `apps/web/messages/{en,fr}.json`; a unit test fails
  if the two files ever have different keys or placeholders.

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

**How the database layer is enforced:** tenant requests run as the
`educore_app` Postgres role, which has no `BYPASSRLS` (migration
`0004_rls_app_role`). `forTenant()` wraps every operation in a short
transaction that sets `app.tenant_id` and `SET LOCAL ROLE educore_app`;
`withRls()` does the same for multi-statement work (jobs, imports, raw SQL).
Both settings are transaction-local, so they are safe on pgbouncer/Supavisor
pooling. The `postgres` role (which does bypass RLS on Supabase) is used only
by `platformPrisma()` for audited platform-admin work, by Auth.js, and by
migrations. Don't call `$transaction` on a `forTenant()` client — use
`withRls()`.

Platform tables (`tenants`, `subscriptions`) are read-only for a school's
session, with one exception: `tenants."onboardingDismissedAt"` (column-level
grant + own-row policy, migration `0008`). Anything else on a school's
tenant row — plan, status, settings, branding — changes only through the
audited platform path.

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
teachers, 1 school admin, 1 bursar, 1 parent, plus a platform admin — and
fee items, a three-term fee schedule, discounts and bus/lunch sign-ups. Every seeded user
shares the password `Passw0rd!23`.

| Role | Email |
|---|---|
| Platform admin | `platform.admin@educore.dev` |
| School admin | `admin@greenfield.edu` |
| Teacher | `c.eze@greenfield.edu` |
| Bursar (accountant) | `bursar@greenfield.edu` — fees, billing, payments |
| Parent | `parent@example.com` |

## Tests

```bash
pnpm test          # Vitest — RBAC permission matrix, tenant-isolation, business logic
pnpm --filter web test:integration   # invoicing & payments end to end (needs DATABASE_URL)
pnpm test:e2e       # Playwright — login + dashboard smoke tests
```

Database-backed suites (`packages/db/tests/*`, `apps/web/src/**/*.integration.test.ts`)
need a Postgres with every migration in `packages/db/prisma/migrations`
applied, reached through `DATABASE_URL` as the database owner. A throwaway
local Postgres 16 is enough: `createdb educore_test`, then
`for f in packages/db/prisma/migrations/0*/migration.sql; do psql educore_test -f "$f"; done`.

The tenant-isolation suite (`packages/db/tests/tenant-isolation.test.ts`) is
the most important test in this repo: it proves Tenant A cannot read or
write Tenant B's data through the scoped Prisma client.
