# Changelog

All notable changes to EduCore are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## Phase 2 — Daily academics (2026-10-02)

Spec: `claude/phase-2-spec.md` (confirmed 2026-09-30): terms set per
school (default 3); subject score = school-set components adding up to 100;
position in class optional (off by default); attendance once a day per class.

### Added (milestone 2.4 — timetable)

- **Bell schedule** (`/timetable/periods`, admins): the school day's
  periods and breaks with start/end times, starting from a common default
  (8 periods, break, lunch). No overlaps; numbered by start time; can't
  remove or turn into a break a period that has lessons.
- **Class timetables** (admins): pick a class, click any slot, choose the
  subject + teacher (only this class's teacher assignments) and an optional
  room; change or remove (confirmed). Every change audited.
- **Clash detection**: a teacher or room can't be in two places at once,
  and a class can't have two lessons in one slot — a clear message names
  the other class ("Chinedu Eze is already teaching Grade 6 A then"), and
  the database enforces the same rules so two people saving at once can't
  double-book. Room names match ignoring case and spacing.
- **Views**: admins can view any teacher's week; teachers see **My
  timetable** (all their classes); students their class; parents their
  child's class (child picker for several children; Timetable added to the
  parent sidebar). Today's column is highlighted. **Print** gives a clean
  page without the sidebar.
- **Dashboard**: the teacher's "Today's classes" now counts only the
  active year's lessons.
- ASSUMPTION: one bell schedule per school; school days Monday–Friday.
- Greenfield demo: default bell schedule; starter week for Grade 5 A
  (Mathematics, English) and Grade 6 A (Science in the Science Lab).

### Security (milestone 2.4)

- Migration `0013_timetable` (additive): `timetable_periods` (forced RLS,
  HH:MM and end-after-start CHECKs); `timetable_entries.academicYearId` plus
  unique slot rules for section, teacher and normalised room, and a day /
  period CHECK. Verified live: teacher, room and class double-bookings,
  bad times and cross-school writes all refused. Added to the isolation
  suite; RBAC test (only admins edit timetables).

### Added (milestone 2.3 — report cards)

- **Report cards** (`/report-cards`, admins and form teachers): per term,
  every section with results published / not, comments written, cards
  generated and cards changed since generating.
- **Comments** (`/report-cards/[sectionId]`): the form teacher writes a
  comment per student; admins also write the principal's comment, with
  "apply to all blank principal's comments". Up to 600 characters, saved
  together, each change audited. Teachers can never set the principal's
  comment (ignored server-side) and only see their form sections.
- **Generate** (admins): needs the class's results for the term to be
  published. Runs in the background (Inngest, 20 students per step, one
  generation per school at a time) with a live progress bar. Each card's
  contents are **frozen** at generation — results with component marks,
  grade and remark, class averages, average, position (if the school shows
  it), term attendance, both comments, next term's start date and the
  grading key — so a card never changes afterwards. Regenerate to update.
  Unpublishing results resets the class's cards to "not generated".
- **PDF**: A4, one card per student, school name, in the school's language
  (English or French), with Noto Sans bundled so names like Adébáyọ̀
  Ọlábísí print correctly. Download one card, or a whole section as one
  PDF for printing (admins / form teacher).
- **Parents and students** download their child's card from the results
  card on the profile once results are published and the card exists.
  Same access rules as the profile — other children's cards answer 404.
- Greenfield demo: form-teacher comments for four Grade 5 A students.

### Changed (milestone 2.3)

- Teachers get **Report cards** in the sidebar. Admins can create/update
  report cards (generate, comments); teachers update (comments) and export
  their form sections; nobody deletes them.
- Deleting a term with report cards is refused.

### Decision (milestone 2.3)

- **PDFs are not stored in Supabase Storage** (the spec's plan). Storing
  them needs a Supabase service-role secret in Vercel (security setup is
  parked). Instead each card's contents are frozen in the database at
  generation and the PDF is drawn from them on download, behind the app's
  permission checks — same "never changes" guarantee, far less space, and
  no file URL that could leak. Storage can be added later.

### Security (milestone 2.3)

- Migration `0012_report_cards` (additive only): `report_cards.termId`
  (RESTRICT), comments (CHECK ≤ 600 chars), `snapshot`, `updatedAt`, unique
  (tenant, student, term); old free-text `term` column kept but unused;
  `report_card_runs` with forced RLS. Verified live: cross-school runs and
  cards refused, over-long comments refused. Added to the isolation suite.

### Added (milestone 2.2 — assessments & scores)

- **Gradebooks** (`/assessments`): one per section + subject + term, listed
  with progress ("12 of 18 scores entered") and a Published badge.
  Admins see every subject taught; teachers only the subjects they teach
  (being form teacher doesn't open other teachers' subjects).
- **Gradebook grid**: students × score components, "out of" shown per
  column; totals, grades and class average / highest / lowest update as
  you type (same maths as the server). Enter moves down a column; invalid
  cells are marked and block saving; unsaved-changes guard. Empty =
  not scored yet; clearing a score removes it (audited).
- **Maths** (`lib/results.ts`, tested): a component contributes
  score ÷ maxScore × weight (so a test marked out of 50 for a 20-mark
  component is scaled); totals rounded to 1 d.p.; a subject gets a grade
  only when every component is scored (a missing exam never shows as F);
  averages use complete subjects only; positions share ties (1, 2, 2, 4).
- **Save**: only real changes written, one audit entry per score
  (create / update / delete, before/after), one RLS transaction; the
  gradebook column (assessment) is created with the first score.
- **Score files**: "Fill from a file" reads a CSV (the gradebook's own
  export works as a template) into the grid with a row-by-row problem
  list — nothing is saved until you review and save. CSV/Excel export.
- **Class results** (`/assessments/results`, admins): per class and term,
  every student's subject totals and grades, average, position (if the
  school turned it on; within the section), subject averages, and how many
  scores are still missing.
- **Publishing**: admins publish a class's term results — families can see
  them and scores lock for teachers — or unpublish to correct them. Both
  audited. Confirmation warns if scores are missing.
- **Families**: the student profile shows the latest published term's
  results (subjects, totals, grades, remarks, class averages, average,
  position if enabled); students get "My results". Unpublished results
  are never shown to families. Staff see the current term with a
  Published / Not published badge.
- Greenfield demo: First term scores for Grade 5 A (Mathematics, English:
  complete) and Grade 6 A (Science: Midterm only), not yet published.

### Changed (milestone 2.2)

- RBAC: new `results` resource (admins publish; teachers, parents, students
  read). Admins can now correct scores while results are unpublished;
  teachers can export scores.
- Deleting a term that has scores is refused with a clear message.
- The unused `marks.grade` column is no longer written (grades are always
  computed from the school's current scale).

### Security (milestone 2.2)

- Migration `0011_scores_and_publishing`: `assessments.termId` (backfilled;
  `ON DELETE RESTRICT`), one assessment per term/section/subject/component,
  CHECKs `maxScore > 0` and `score >= 0`; `result_publications` with forced
  RLS. Verified live: existing midterm placed in First term, cross-school
  publication refused, negative scores refused, term with scores
  undeletable. Added to the tenant-isolation suite.

### Added (milestone 2.1 — attendance)

- **Registers** (`/attendance`): pick a day (previous / next / today, never
  the future) and see every section you can take a register for — taken,
  partly taken or not taken, with how many are absent. Admins see all
  sections; teachers see sections they're form teacher of or teach in.
- **Daily register** per section: Present / Absent / Late / Excused per
  student (keyboard- and phone-friendly radio buttons), **Mark all
  present**, optional note per student, running tally, "last saved by …",
  warning before leaving with unsaved changes.
- **Edit window**: teachers can change a register for N days (school
  option, default 7; 0 = same day); after that it's read-only for them.
  Admins can correct any earlier day in the year. Nobody can mark the
  future or outside the active year.
- **Every entry audited**: only real changes are written, each with its own
  audit entry (before/after); re-saving an unchanged register writes
  nothing. Registers are never deleted.
- **Term summary** per section: present / absent / late / excused and
  attendance rate per student (below 90% highlighted) plus the section
  total; **CSV/Excel export** (`/api/exports/attendance`).
- **Parents** see their child's attendance this term (rate, counts, recent
  absences with notes) on the child's profile; staff see it there too.
- **Dashboards**: admins get "Registers not taken today (x of y)"; teachers'
  "Attendance not yet marked" is now real (their form sections). Weekends
  show "No school today".
- Attendance rate = (present + late) ÷ (days marked − excused).
  ASSUMPTION: school days are Monday–Friday.
- Greenfield demo: registers for 21–29 Sep 2026 for both sections.

### Changed (milestone 2.1)

- RBAC: school admins can now create/update attendance (was read/export);
  teachers can export. Nobody except the platform can delete attendance.
- Teachers now see students in sections they're **form teacher** of, not
  only sections they teach a subject in (`lib/teacher-sections.ts`).
- Migration `0010_attendance_updated_at`: `attendance.updatedAt`.

### Added (milestone 2.0 — academic settings)

- **School settings** (`/settings`, school admins), four tabs:
  - **Terms** per academic year: add, edit, delete, "make current" (one
    current term per school, only in the active year). "Add 3 terms" fills
    in suggested dates to adjust. Terms must sit inside the year and can't
    overlap.
  - **Grading scale**: bands "from score → grade + remark", starting from a
    common default (A 70+ … F below 40); live preview of each grade's
    range; must include a band from 0; no repeated minimums or grades.
    Totals are rounded to one decimal place before grading (69.95 → A).
  - **Score components** (e.g. CA1 20 + CA2 20 + Exam 60), with a running
    total that must be exactly 100. A component with recorded scores can be
    renamed or re-weighted but never removed (that would delete scores).
  - **Options**: show position in class (off by default); how many days
    teachers can change a register (default 7).
- **Form teacher** per section (Academics → Classes → section).
- **Current term** under the dashboard greeting ("2026/2027 · First term").
- Grading and term rules as pure, tested functions (`lib/grading.ts`,
  `lib/terms.ts`); every settings change audited.
- RBAC: new `academicSettings` resource — admins change, teachers read.
- Greenfield demo: three terms (First current), default scale, Midterm 40
  + Exam 60, form teachers for both sections.

### Changed (milestone 2.0)

- `AssessmentType.weight` now means "marks out of 100" (was a fraction);
  migration converts 0.4 → 40.

### Security (milestone 2.0)

- Migration `0009_academic_settings`: `terms`, `grade_bands`,
  `academic_settings` with forced RLS and the standard tenant policy;
  CHECK constraints (term dates, 0–100 scores, 0–60 edit days, weight
  0–100) and a one-current-term-per-school index. Verified live: other
  school's rows invisible, cross-school insert blocked, bad values refused.
  School-editable options are kept off the `tenants` row on purpose.

## Phase 1 — Onboarding (2026-09-30)

Spec: onboarding-first — foundations, academic structure, people, CSV
import/export, onboarding checklist. Inngest for jobs, Supabase Storage.

### Added (milestone 1.4 — onboarding checklist)

- **Setup checklist on the school admin's dashboard**, in order: academic
  year → classes & sections → teachers & staff → teacher assignments →
  students → invite staff. Each step **ticks itself off from real data**
  (nothing is checked by hand, so it can't drift: remove the last student
  and the step goes back to to-do), shows what's there ("2 classes, 2
  sections"), and links to the right screen — with a second route where
  there is one (type it in, or import a file).
- Steps that depend on earlier ones show **"Available after: …"**; the next
  step to do is highlighted. The invite step is done when every staff
  account can sign in or has a live invite (parents are left out on
  purpose — schools usually invite them later).
- **Hide / show**: admins can hide the checklist; while setup is unfinished
  a one-line reminder with a "Show checklist" button stays on the
  dashboard. Hiding is audited (`Tenant` UPDATE).
- RBAC: new `onboarding` resource — school admins only (read/update).
- English and French text.

### Security (milestone 1.4)

- Migration `0008_onboarding_dismissed`: new `tenants.onboardingDismissedAt`.
  The tenant row was read-only for a school's session; it now has exactly
  one writable column. `educore_app`'s table-wide UPDATE on `tenants` is
  revoked, replaced by a column grant on `onboardingDismissedAt` /
  `updatedAt` plus an RLS policy limited to the school's own row. Verified
  live: own flag writable; other school's row 0 rows; `plan` and `settings`
  refused. Added to the tenant-isolation integration suite.

### Added (milestone 1.3 — import & export)

- **Import & export page** (`/imports`, school admins): download a template,
  upload a CSV, get a **validation report** before anything is written —
  row number, column and a plain-language problem for every issue
  ("No class called 'Grade 9' in this academic year", "Repeated — already
  used on row 12"…), downloadable as CSV. Then **Import N rows**: valid rows
  are imported in the background with a **live progress bar**; problem rows
  are skipped and can be fixed and re-imported.
- Three importers:
  - **Students** (+ optional parent/guardian per row): upsert on admission
    number; class/section matched by name in the chosen year; siblings
    share a parent by email (created once, linked to each child, first
    parent becomes primary contact).
  - **Teachers & staff** in one file (`role` = teacher / admin /
    accountant): upsert on email; an import never changes someone's role
    or reuses another person's employee ID.
  - **Classes & sections** for a year: upsert on name; order and capacity
    updated.
- Forgiving parsing: UTF-8 or Windows-1252 files, comma or semicolon,
  headers in any case/spacing with aliases ("Admission Number",
  "Surname"…), day-first dates (07/03/2016) or ISO, "F"/"Female", extra
  columns ignored (and mentioned). Excel files get a "save as CSV UTF-8"
  hint. Limits: 2 MB, 5,000 rows.
- **Background jobs with Inngest** (`/api/inngest`): 50 rows per step, each
  in the school's RLS transaction; one import per school at a time; steps
  retried individually and resumed after a crash; every batch re-validates
  against current data; each row in its own savepoint so one bad row
  doesn't undo the batch; every created/updated record audited; cancel
  stops at the next batch.
- **Exports**: Students, Teachers & staff, Parents as **CSV or Excel**, from
  an Export button on each list (uses the current search/filters) or the
  Import & export page. Columns match the import templates. Same row scope
  as the lists (a teacher's export contains only their students, without
  family contact details). Formula injection neutralised in every cell.
- **Import records** (`import_jobs`, migration 0007): tenant-scoped with
  RLS; the uploaded file is stored only until the import finishes or is
  cancelled, then deleted (data minimisation); 2 MB CHECK constraint.
  Verified live: another school's import is invisible, cross-school writes
  are blocked.
- Tests: CSV parsing/encoding/dates/formula escaping (11), importer
  validation for all three kinds (13) — 98 web unit tests in total.

### Added (milestone 1.2 — people)

- **Students** (`/students`): search, filter by class and status, sort,
  year switcher; add and edit (class/section checked to belong together);
  change status (active, inactive, graduated, withdrawn) — students are
  never deleted, so their history stays. **Profile page** with details and
  parents/guardians.
- **Parents & guardians**: add a new parent from a student's page (creates
  their account), link an existing parent to a sibling, set the primary
  contact, unlink. `/parents` lists every family contact with their
  children, phone and sign-in status.
- **Teachers** (`/teachers`) and **Staff** (`/staff`, admins and
  accountants): add, edit, deactivate/reactivate (blocks sign-in, keeps
  history), search and filter. Guard rails: you can't deactivate or demote
  yourself, and a school always keeps at least one active admin.
- **Invites**: "Send invite" creates a one-time, 7-day link to set a
  password (`/invite/[token]`). Emailed via Resend when configured;
  otherwise the admin gets the link to share. Only a SHA-256 hash of the
  token is stored, the link is single-use (atomic claim), re-inviting
  voids the old link, attempts are rate-limited, and the new password is
  written in the school's RLS transaction with an audit entry. Each person
  shows "Not invited / Invite sent / Invite expired / Can sign in /
  Deactivated".
- **Row-level access to students** (architecture rule #2), enforced in the
  query itself: parents see only their own children, teachers only
  students in sections they teach, admins and accountants the whole school.
  A parent opening another child's URL gets "not found". Parents don't see
  other guardians on file.
- Sidebar: Students, Parents, Teachers, Staff for admins; "My students" for
  teachers; "My children" for parents; Students (read-only) for accountants.
- Server errors now point at the exact field for duplicates (email,
  admission number, employee ID, subject code).
- Tests: people validation (10), invite tokens (6), student row scope (5),
  plus earlier suites — 74 web + 21 auth unit tests.

### Added (milestone 1.1 — academic structure)

- **Academic setup** (`/academics`, school admins): four tabs.
  - **Academic years**: create, edit, make active, delete. A school's first
    year becomes active automatically; making another year active switches
    it in one transaction.
  - **Classes & sections**: per academic year (year switcher, defaults to
    the active year), with student counts and optional section capacity.
  - **Subjects**: searchable, sortable list with a unique short code.
  - **Teacher assignments**: who teaches which subject in which section;
    filter by class, subject or teacher; change teacher or remove.
- Every change is permission-checked, validated with the same Zod schema in
  the browser and on the server, and written with its audit entry in one
  tenant-bound transaction (visible in `/audit-log`).
- **Every id a form sends is re-checked to belong to the school** before it
  is linked — Postgres foreign-key checks ignore RLS, so without this a
  guessed id from another school could be attached.
- **Safe deletes**: years, classes, sections and subjects that still hold
  students, attendance, assessments, timetable entries, fee structures or
  invoices can't be deleted (the schema cascades); the message says what's
  still attached. The active year can never be deleted.
- **Database rules** (migration 0006): one active year per school (partial
  unique index), year must end after it starts, unique year names per
  school, unique class names per year, unique section names per class,
  capacity > 0. Verified on the live database.
- **Mobile layout**: below tablet width the sidebar becomes a top bar with a
  slide-in menu (down to 375px); role names are translated.
- `runAction()` wrapper for server actions: permission first, then friendly
  translated errors for validation, duplicates, "in use" and not-found —
  internal errors are logged, never shown.
- `useServerForm` + `FormDialog`: forms re-show server field errors inline;
  `ConfirmAction` can now be opened from dropdown menus.
- `formatDateOnly()` so date-only values never shift a day in time zones
  west of UTC.
- Tests: academic validation (10), RBAC for academic setup (1 more), date
  formatting (1 more); DB integration suite `academic-structure.test.ts`
  for the new constraints and cross-school isolation.

### Added (milestone 1.0 — foundations)

- **`packages/ui`** — design-system primitives moved out of the app and
  extended: table, select, textarea, dialog, alert dialog, dropdown menu,
  empty state (plus existing button, input, label, card, badge, skeleton).
- **List kit** (`apps/web/src/components/list/`): debounced search, filter
  dropdowns, sortable column headers, pagination with page size — all
  URL-driven so lists are shareable and back-button friendly. Parsing is
  whitelisted in `lib/list-params.ts` (11 tests).
- **Forms & actions**: `FormField` (label, hint, inline error, aria wiring),
  `ConfirmAction` (confirmation dialog + toast for destructive actions),
  `ActionResult` return type for server actions.
- **School settings** (`lib/tenant-settings.ts`): locale, time zone,
  currency, date style, grading scale, feature flags — validated with safe
  per-field fallbacks. **Formatting** (`lib/format.ts`): money, numbers,
  dates and "today" in the school's time zone (12 tests).
- **Audit log page** (`/audit-log`): searchable, filterable, sortable list
  of every recorded change with before/after details. School admins see
  their school; platform admins see all schools; accountants see finance
  records only (assumption: least privilege).
- **`auditedMutation()`**: a change and its audit entry are written in one
  RLS-bound transaction; `passwordHash` and tokens are redacted from
  snapshots (4 tests). `auditContextFor()` captures actor, school, IP and
  user agent (4 tests).
- **Login rate limiting**: 5 attempts per account+IP and 30 per IP per 15
  minutes, checked before any database work. Upstash Redis when configured,
  in-memory fallback otherwise; fails open if the limiter is down (7 tests).
- **Login page** explains `?error=` codes (wrong school, session required,
  too many attempts…) instead of failing silently; the form is fully
  translated.
- "Coming soon" pages (with the roadmap phase) replace the 404s behind
  sidebar links that aren't built yet.
- Translation parity test: English and French must have the same keys and
  placeholders.

### Fixed

- Money showed as "₦150000": now "₦150,000", in the school's own currency.
- "Attendance today" and "today's classes" used the UTC date; they now use
  the school's time zone (a Lagos school at 00:30 is already on the next day).
- next-intl logged `ENVIRONMENT_FALLBACK` on every page (no time zone set).
- `pnpm test` in `apps/web` tried to run the Playwright spec under Vitest.
- Remaining hard-coded English on the dashboard is now translated.

### Security

- **Row Level Security now actually enforces tenant isolation.** The app
  connects as Supabase's `postgres` role, which has `BYPASSRLS`, so the RLS
  policies from Phase 0 were never applied to app queries — isolation
  rested on the Prisma extension alone. New role `educore_app` (no
  BYPASSRLS); `forTenant()` and `withRls()` switch to it per transaction
  with `SET LOCAL ROLE` + `app.tenant_id`. Tenants can read only their own
  `tenants`/`subscriptions` row; `accounts`/`verification_tokens` are
  denied. Verified on the live database: unfiltered SELECT returns only the
  caller's school, cross-tenant INSERT is rejected, and no tenant set
  returns zero rows.
- Tenant-isolation suite: 5 new tests that exercise RLS with raw SQL and no
  application-level filter.
- The tenant role can no longer UPDATE/DELETE/TRUNCATE `audit_logs` at all
  (migration 0005), on top of the append-only trigger.

## Phase 0.2 — Fix production login (2026-09-28)

### Fixed

- **Every auth route returned 500 in production** (`/api/auth/session`,
  `/api/auth/providers`, `/dashboard`): the `argon2` package loads a
  node-gyp native binary that was missing from Vercel's serverless bundle
  ("No native build was found for platform=linux ... node=24.20.0").
  Replaced it with **`@node-rs/argon2`**, which ships prebuilt N-API
  binaries per platform and needs no build step. Still argon2id.
- Hash parameters are now explicit (OWASP baseline: m=19 MiB, t=2, p=1).
  Existing hashes keep verifying because parameters are read from the PHC
  string — confirmed against the live seeded users' hash format.
- **Every login was rejected** with "Incorrect email or password for this
  school", even with the right password. The login form posted an unset
  `subdomain` field, which next-auth serialised as the string `"undefined"`,
  so the cross-tenant guard compared `"greenfield"` to `"undefined"`.
- **Security: the cross-tenant login guard trusted client input.** The
  school a login is for now comes only from the request host (middleware
  headers), in `apps/web/src/lib/login-guard.ts`. Previously a caller could
  omit the field to skip the check.
- **After signing in, school users were bounced back to
  `/login?error=WrongSchool`.** The app layout required a school subdomain,
  which the `*.vercel.app` root domain can't have. On the root domain the
  app now uses the user's own school from their session (same rule as the
  login guard); on a school's own subdomain it must still match. A
  suspended school now ends existing sessions too.
- **Dashboard crashed with "Application error: a server-side exception"**
  (digest 107561826). The server-built nav items carried lucide icon
  components into the client `<Sidebar>`, which React can't serialise.
  Nav items now carry an icon name; the sidebar maps it via
  `components/layout/nav-icons.tsx`.
- **Security: tenant headers could be forged.** Middleware now strips any
  client-sent `x-tenant-*` headers before setting its own.

### Added

- `apps/web/src/lib/login-guard.test.ts`: 11 tests for the login guard
  (own/other subdomain, custom domain, root domain, suspended school,
  platform admin).
- `packages/auth/src/passwords.test.ts`: argon2id format, correct/incorrect
  password, per-hash salt, malformed-hash handling, and backward
  compatibility with both existing hash formats.

## Phase 0.1 — First production build (2026-09-11)

### Fixed

- **Build now passes on Vercel** (first time `prisma generate` + `next build`
  ran end to end). Verified locally with a full `next build` and a clean
  `tsc --noEmit` across `apps/web`, `packages/auth` and `packages/db`.
- **Duplicate `@auth/core`**: `@auth/prisma-adapter@^2.7.4` had floated to a
  release built on `@auth/core@0.41`, while `next-auth@5.0.0-beta.25` uses
  `0.37.2`. Pinned the adapter to `2.7.2` and added a pnpm override so only
  one copy is ever installed.
- **Session typing**: the JWT augmentation targeted `next-auth/jwt`, which in
  v5 only re-exports `@auth/core/jwt`, so `token.role`/`token.tenantId` were
  `unknown`. Now augments `@auth/core/jwt` directly.
- **RBAC matrix type**: `Matrix[Role.PLATFORM_ADMIN]` used a value as a
  type; now `Matrix[typeof Role.PLATFORM_ADMIN]`. (Vitest doesn't type-check,
  which is why the RBAC tests passed despite this.)
- **Request db client**: `requireUser()` returned a union of the base and
  tenant-scoped Prisma clients, which TypeScript can't call methods on. Both
  paths now share the `TenantScopedClient` type.
- **Native/engine bundling**: `argon2` and `@prisma/client` are now direct
  dependencies of `apps/web`, so Next.js can keep them external instead of
  bundling them (bundled `argon2` fails with "No native build was found").
- `next-intl` messages typed as `AbstractIntlMessages` in `providers.tsx`.
- **Tenant-resolution middleware never ran.** It lived at
  `apps/web/middleware.ts`, but with a `src/` directory Next.js only picks
  up `src/middleware.ts`, so no request was ever tenant-resolved by
  subdomain. Moved it; the build output now lists `ƒ Middleware`.

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
