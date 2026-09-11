# Changelog

All notable changes to EduCore are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## Phase 0 — Foundation (2026-09-07)

### Added

- **Monorepo scaffolding**: pnpm workspaces + Turborepo (`apps/web`,
  `packages/db`, `packages/auth`).
- **Data model**: full Prisma schema covering every entity in the project
  spec — Tenant, Subscription, User, AcademicYear, ClassGrade, Section,
  Subject, ClassSectionSubject, Student, Guardian, StudentGuardian, Teacher,
  Staff, Attendance, AssessmentType, Assessment, Mark, ReportCard,
  TimetableEntry, Announcement, MessageThread/Message, FeeType,
  FeeStructure, Invoice, InvoiceLine, Payment, AuditLog. Assumption stated
  explicitly: `User.email` is globally unique across the platform (not just
  per tenant) — documented at the top of `schema.prisma`.
- **Multi-tenancy, two layers** (architecture rule #1):
  - Prisma Client Extension (`packages/db/src/tenant-scope.ts`) that
    transparently injects `tenantId` into every query against a
    tenant-owned model.
  - PostgreSQL Row Level Security, `FORCE`d, on every tenant-owned table
    (`packages/db/prisma/migrations/0002_rls`), keyed on
    `app.tenant_id`. Known Phase 0 limitation around pgbouncer/`SET LOCAL`
    documented in `packages/db/src/rls.ts`.
- **RBAC**: single-source-of-truth permission matrix
  (`packages/auth/src/permissions.ts`) covering all 6 roles
  (`PLATFORM_ADMIN`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`, `PARENT`,
  `ACCOUNTANT`) × 23 resources × 6 actions, plus row-level scope predicates
  for parent/student/teacher data access. 9 unit tests passing.
- **Audit log**: immutable, tenant-scoped `AuditLog` model plus
  `withAudit()`/`recordAudit()` interceptor helpers
  (`packages/db/src/audit.ts`). Every role — including `PLATFORM_ADMIN` — is
  granted read/export only on the audit log; no role can update or delete
  an entry.
- **Auth**: Auth.js (NextAuth v5) with credentials provider (argon2id
  password verification) plus optional Google/Microsoft OAuth, JWT
  sessions (30-day sliding), cross-tenant login guard (a user cannot sign
  in through a different school's subdomain).
- **Tenant resolution middleware** (`apps/web/middleware.ts`): resolves
  tenant by subdomain (with custom-domain fallback) on the Edge runtime,
  forwards the result as request headers; the actual Tenant row lookup
  happens in `src/lib/tenant.ts`, cached per-request.
- **Base UI**: role-aware sidebar navigation driven by the same permission
  matrix the API enforces, light/dark theme via CSS variable design tokens,
  hand-rolled shadcn/ui-style primitives (Button, Card, Input, Label,
  Badge, Skeleton), role-specific dashboard stat cards for all 6 roles.
- **i18n**: next-intl wired up with English + French message catalogs
  (cookie-based locale, since the URL's first segment is reserved for
  tenant subdomain routing).
- **Seed data**: Greenfield Academy demo school — 2026/2027 academic year,
  2 classes (Grade 5-A, Grade 6-A), 3 subjects, 3 teachers, 12 students,
  1 school admin, 1 parent (linked to 1 student), 1 platform admin,
  attendance + marks + invoices + one paid invoice, one announcement.
- **Tests**: RBAC permission-matrix unit tests (Vitest, passing in-repo);
  tenant-isolation test suite proving Tenant A cannot read/write Tenant B's
  data through the scoped Prisma client; Playwright login/dashboard smoke
  test.
- **Docs**: README.md, DEPLOYMENT.md, this CHANGELOG.md, `.env.example`.

### Infrastructure

- Provisioned a real Supabase Postgres project (`educore-greenfield`,
  `eu-west-1`, free tier) via Supabase MCP tooling: migrated (schema + RLS),
  security-advisor-clean, and seeded with the demo data above.

### Known limitations / deferred to Phase 1

- **Vercel deployment not completed automatically.** The automated deploy
  path hit a `403` permission error creating a new Vercel project on the
  connected account/integration. See DEPLOYMENT.md for the ~5-minute manual
  path (Supabase side is fully ready; only the Vercel project creation +
  env vars are manual).
- RLS's `app.tenant_id` session variable is not yet wired into the ordinary
  per-request ORM hot path (only into `withRls()` for background
  jobs/raw SQL) — see the caveat in `packages/db/src/rls.ts`. The Prisma
  Client Extension already protects the hot path; this is additional
  defense-in-depth planned for once the background-job runner is in place.
- Payments (Stripe), file storage (R2/Supabase Storage), background jobs
  (Inngest/Trigger.dev), email (Resend), CSV import/export, and the
  platform admin panel are Phase 0 schema/scaffolding only — no UI/routes
  yet. Tracked for subsequent phases per the project's phased delivery plan.
