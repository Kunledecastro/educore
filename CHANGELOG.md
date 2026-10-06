# Changelog

All notable changes to EduCore are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## Phase 5 — Student accounts and assignments (complete, 2026-10-06)

Spec: `claude/phase-5-spec.md` (confirmed 2026-10-05): student logins off by
default and switched on per class; students sign in with school short name +
admission number; submitted work in Supabase Storage; assignment marks can
optionally count towards CA.

### Added (milestone 5.3 — assignments count towards CA, and reports, 2026-10-06)

- **"Counts towards" a score component** on each scored assignment (e.g.
  CA1). Teachers of the subject and admins choose it.
- **Send marks to the gradebook**: a pupil-by-pupil preview ("in gradebook
  now" → "from assignments"), then the teacher confirms. Each pupil's marked
  work is turned into percentages, averaged across every assignment linked
  to that component for the class and term, and scaled to the gradebook
  column (e.g. 5/10 and 18/20 → 70% → 14/20). "Not handed in" counts as 0;
  unmarked work is left out; pupils with no marked work keep whatever the
  gradebook already has. Sending again only changes what's different.
- Follows the gradebook's rules: the subject's teacher or an admin only, the
  active year only, **never into published results**, each score audited
  (marked "From N assignments"). Term results and report cards then use
  these scores as usual.
- **Assignment reports** (Assignments → Reports, staff): completion per
  class and subject — assignments, handed in, late, not handed in, marked,
  completion % — filterable by term; click a class for **each pupil's
  missing work**. Both export to Excel or CSV.

### Security (5.3)

- Migration `0027_assignment_ca`: `assessmentTypeId` (only allowed on
  scored work — database CHECK) and `caSentAt` on assignments. A linked
  assignment can't have its maximum score removed.
- Scores sent are always recomputed on the server; another school's
  components and classes answer "not found". Reports are scoped like the
  rest of assignments (teachers: their classes only).

### Tests (5.3)

- 9 integration tests (who may link and send, averaging and scaling,
  existing scores kept, idempotent re-send, the column's own maximum,
  published-results lock, school isolation, completion and missing-work
  reports and their scoping) and 4 unit tests for the scoring rule.
  Totals: unit 342, web integration 122, db 29, auth 35.

### Added (milestone 5.2 — handing in and marking, 2026-10-06)

- **Pupils hand work in online** from the assignment page: a typed answer
  and/or files (PDF, Word, photos — "Take a photo" opens the phone camera).
  Photos are **shrunk on the phone** (max 1600 px, JPEG) before upload, so a
  6 MB camera photo becomes a few hundred KB. Up to 10 files, 10 MB each.
  Late work is accepted and flagged. Work can be changed and handed in again
  until it's marked (files can be taken out too).
- **Parents can hand in for their child** — a school setting on the
  Assignments page: *Automatic* (default: only for classes whose pupils
  don't have logins), *Always* or *Never*.
- **Marking view** on each assignment (teachers of that subject, admins):
  every pupil with *handed in / late / nothing yet / returned / marked / not
  handed in*, filters ("To mark", "Nothing yet"…), the work and its files,
  score + comment, **return for corrections** (comment required; the pupil
  can hand in again), **record paper work** with its mark, and after the due
  date **"mark the rest as not handed in"** (0 if scored; reversible by
  letting a pupil hand in late). Form teachers can see but not mark.
- **Marks are shared when the teacher chooses** ("Share marks with
  families"): until then families see "Marked" without the score.
  Comments on returned work show straight away.
- **Notifications**: families see everything in EduCore now; once email
  (Resend) is set up, pupils' parents get an email when work is returned or
  marks are shared — naming the work and the pupil, never the score.
- **Each school has a storage share** (500 MB by default,
  `STORAGE_QUOTA_MB_PER_SCHOOL`). Uploads started but never handed in are
  deleted after a day by a nightly job.

### Security (5.2)

- Migration `0026_submissions`: `isMissing` flag (database-checked to be a
  marked record) and a `pending_uploads` table (RLS; key must be inside the
  school's folder). Handed-in work still can't be deleted by the app.
- A pupil can hand in only their own work; a parent only their own child's,
  and only when the school setting allows; upload grants are personal, so
  one pupil's upload can't be attached by another. Two devices handing in at
  once are serialised (row lock). Scores are checked against the maximum.
- Submission files are downloadable by the pupil, their parents, the class's
  teachers and admins — no one else (five-minute links).
- Every hand-in, mark, return, "not handed in", and marks release is audited.

### Tests (5.2)

- 17 new integration tests (own-work only, parent-only-their-child and the
  school setting, late, resubmit, file removal, file access across classes
  and schools, borrowed grants, quota, marking rights, score limits, release
  rules, return-and-redo, paper work, not-handed-in, DB constraint, audit,
  abandoned-upload clean-up) plus unit tests for the new rules, photo sizing
  and the notification email. Totals: unit 338, web integration 113, db 29,
  auth 35.

### Added (milestone 5.1 — assignments, 2026-10-05)

- **Assignments** (new sidebar item; Free trial, Standard and Premium plans):
  teachers set homework or a project for a subject they teach, in one or
  more classes at once (each class gets its own copy). Title, instructions,
  due date and time (school's time zone), optional "marked out of", and
  whether it's handed in **online** or **on paper**. Save as a draft or
  publish straight away; close, reopen, edit, and delete (only while nothing
  has been handed in). Admins can manage every class's assignments.
- **Worksheets**: attach up to 5 files (PDF, Word, JPEG, PNG; 10 MB each).
  Files go straight from the browser to private storage with a one-time
  link; the server then checks the file really is the type it claims (by
  its first bytes), its size, and a malware-scan hook, and deletes anything
  that fails. Downloads use five-minute signed links.
- **Students and parents** see published work for their own (child's) class,
  never drafts: what's to do / due soon / overdue first. Dashboards get a
  "Work due" card. (Handing work in online arrives in 5.2.)
- Teachers see published work for every class they teach or are form teacher
  of, but only their own subject's drafts.

### Security (5.1)

- Migration `0025_assignments`: three tenant tables with RLS; handed-in work
  can't be deleted by the app role; a stored file must sit inside its own
  school's folder (database CHECK). Upload grants are HMAC-signed, personal,
  tied to one assignment, and expire after 2 hours. The storage service key
  stays on the server; CSP `connect-src` allows only the storage origin.
- Every create/update/delete of an assignment or worksheet is audited.

### Tests (5.1)

- 16 integration tests (who sets work where, who sees what, edits once work
  is in, uploads: wrong type, forged/borrowed grants, missing upload, size
  cap; downloads across classes and schools; delete) plus unit tests for the
  rules, file checks and time-zone conversion.

### Added (milestone 5.0 — student accounts, 2026-10-05)

- **Students → Student logins** (school admins): turn student logins on and
  tick the classes that may sign in. Create logins for a whole class (or one
  student); each gets a **printable login slip** with the school short name,
  admission number and a one-time password (shown once, never stored).
- **Form teachers** can give students in their own form section a new
  password (new slip) and switch a login off/on; admins can do it for anyone.
- **Parent consent** can be recorded per student (who and when).
- **Sign-in** has a "Student" tab: school short name (pre-filled on a
  school's own address) + admission number + password. The first sign-in
  forces the student to choose their own password.
- Students see only their own timetable, results, report cards and
  announcements (no messaging).

### Security (milestone 5.0)

- Migration `0023_student_logins` (additive): `users.username` (unique,
  format-checked `<school>:<admission-no>`), `users.mustChangePassword`;
  `students.parentConsentAt/By`.
- Student accounts carry an internal `@students.educore.invalid` address:
  never emailed (the email channel skips it), never shown.
- A student account can only sign in through the Student tab and staff never
  through it. Each request re-checks that the student is active, their login
  is on and their class still allows logins — switching a class off locks its
  students out at once.
- One-time passwords: ~49 bits from crypto randomness, no look-alike
  characters; argon2-hashed; never in the audit log. Issuing is limited to 20
  students per call; sign-in rate limits apply per student login.
- `studentLogin` permission: admins create/read/update; teachers read/update
  (own form sections, checked in code); nobody else.
- Changing a student's admission number or name updates their login.
- Tests: 6 unit, RBAC, 6 integration (off until enabled, issue + slips + no
  password in audit, form-teacher limits, first-sign-in change, switch-off by
  student/class/withdrawal, consent, school isolation).

## School branding (2026-10-05)

### Added
- **Settings → Branding** (school admins): upload a logo, choose a brand
  colour (10 suggestions, colour picker or hex code) and an address/contact
  line, with a live preview.
- The logo and colour appear in the menu (desktop and phone), on the school's
  own sign-in page (once schools have their own addresses), and on invoices,
  receipts and report cards (logo, contact line, colour rule under the
  header). The public EduCore site keeps EduCore's own look.
- Accessible by design: text on the brand colour is white or black, whichever
  contrasts more (always ≥ 4.5:1); in dark mode a dark colour is lightened so
  buttons and links stay visible.

### Security
- Migration `0022_tenant_logos` (additive): logos in their own platform-only
  table (RLS forced, revoked from the app role), PNG/JPEG only, ≤ 512 KB,
  size and type CHECKs.
- Logos are recognised by their bytes (no SVG — it can carry scripts) and
  served with exact type, `nosniff` and a sandboxing CSP; versioned URLs.
- Colours are validated as `#rrggbb` and turned into numbers before reaching
  the stylesheet, so nothing typed by a school is ever injected as CSS.
- `branding:update` (school admins only) in the permission matrix; every
  change in the school's audit log.
- Tests: 8 unit (colour maths, contrast, image detection), RBAC, 4
  integration (save/audit/keep other keys, byte checks, per-school logos
  replaced and removed, no direct access from school sessions).

## Phase 4 — SaaS platform (complete, 2026-10-05)

Spec: `claude/phase-4-spec.md` (confirmed 2026-10-05): EduCore's own
subscriptions billed with **Paystack in naira** (deviation from the brief's
Stripe Billing, same reason as school fees); editable placeholder prices
(Starter ₦300 / Standard ₦500 / Premium ₦800 per student per month); open
self-serve sign-up with a 30-day trial; announcements + teacher–parent chat.

### Added (milestone 4.4 — announcements and messaging, 2026-10-05)

- **Announcements** (`/announcements`): to the whole school, a class (its
  teachers, students and parents) or a group (e.g. all parents). School
  admins post to anyone, pin, edit and delete; teachers post to classes they
  teach and edit their own. Pinned first, newest next. Everyone's dashboard
  shows the latest three meant for them.
- **Messages** (`/messages`): conversations between teachers and parents about
  a child. Teachers write to parents of students they teach; parents write to
  their child's form and subject teachers and to school admins; admins write to
  any student's parents. Unread counts in the menu and on dashboards; opening a
  conversation marks it read.
- **Safeguarding**: school admins can read every conversation ("All school
  conversations"); replying adds them visibly. Messages can't be edited or
  deleted, and everyone is told so.
- **Notification channels**: one interface — in-app now; email through Resend
  as soon as `RESEND_API_KEY`/`EMAIL_FROM` are set (a background job tells the
  other participants who wrote and about whom, never the message itself); SMS
  or WhatsApp can be added as channels later.
- Bursars (accountants) now see announcements; students see announcements but
  don't message (teacher ↔ parent only).

### Security (milestone 4.4)

- Migration `0021_messaging` (additive): announcement audience must be
  consistent (CHECK), class audience is a real class (FK), length limits;
  thread `createdById`/`lastMessageAt`, participant `lastReadAt`; messages
  length-checked and **UPDATE/DELETE revoked from the app role** (permanent
  record).
- Who may see, post, edit, write to whom and read a thread is decided in one
  pure, tested module (`lib/messaging/rules.ts`); the database query for
  announcement audiences is tested against the rule for every role.
- Recipients are re-checked on the server against the student (a parent can't
  be added to someone else's child's conversation, a teacher can't write about
  a student they don't teach). Everything runs in the school's RLS
  transaction; announcement changes and conversation starts are audited.
- RBAC: students no longer hold `message` permissions; teachers can't delete
  announcements.
- Tests: 10 rule tests, 3 channel tests, RBAC test, 10 integration tests
  (audiences, posting/editing rights, rule ≡ query, recipients for each role,
  unread/read/reply, other parents/teachers locked out, admin safeguarding
  view and visible join, messages immutable, another school sees nothing).

### Added (milestone 4.3 — self-serve sign-up and marketing site, 2026-10-05)

- **Public site**: home (`/`), features (`/features`), pricing (`/pricing`,
  live from the plan catalogue, with a cost estimator by number of students
  and an FAQ), and a terms & privacy summary (`/terms`, marked DRAFT until
  reviewed by a lawyer). English and French. On a school's own address, `/`
  goes straight to that school's sign-in.
- **Sign-up** (`/signup`): school name, short name (suggested from the name,
  checked live: available / taken / reserved), the first admin's name, email
  and password, acceptance of the terms. One transaction creates the school on
  the 30-day free trial and its admin; the browser then signs in and lands on
  the dashboard, where the setup checklist takes over.
- Sign-in page links to the trial for new schools.

### Security (milestone 4.3)

- Short names follow DNS rules (3–30 lowercase letters, digits, single
  dashes) and can't take ~60 reserved names (www, admin, api, billing,
  support, login…); the same list is what middleware refuses as subdomains.
- Rate limits on the public form: 5 sign-ups per IP per hour, 10 per day, 200
  platform-wide per hour; 60 short-name checks per IP per 10 minutes. A hidden
  honeypot field stops simple bots.
- Short names and emails are unique in the database; two sign-ups racing for
  the same name produce exactly one school and no orphan account.
- Passwords: argon2, same rules as invites. Never logged or audited.
- Each sign-up is in the school's audit log and the platform log
  (`TENANT_SIGNUP`); new schools appear in the platform console at once.
- Known limit: no email verification yet (needs Resend) — anyone can start a
  trial with any address they control the password for.
- Tests: 4 short-name unit tests; 4 integration tests (trial + admin +
  audits, duplicate name/email, concurrent race, isolation of the new school).

### Added (milestone 4.2 — subscription billing with Paystack, 2026-10-05)

- **Plan & billing** (`/plan`, school admins): choose a plan and pay on
  Paystack (naira, by card); the card is saved as a reusable authorization
  for monthly payments. Shows the saved card, the next payment (date, plan,
  estimate for today's active students), a scheduled downgrade, failed
  payments and retries, and every EduCore invoice (`ECI-000001`…).
- **Billing rules** (pure, tested): billed monthly in advance per active
  student (minimum one). Paying during the trial keeps the remaining trial
  days (the first month starts when it ends); paying while overdue pays the
  overdue month; after read-only a new month starts that day. Upgrades apply
  at once (new price from the next payment — no proration); downgrades at
  renewal (cancellable). Automatic payment can be stopped (plan ends with the
  paid month, then read-only) and turned back on.
- **Renewals**: daily Inngest job (06:00 Lagos) charges saved cards; a
  declined card is retried 1, 3 and 6 days later inside the 7-day grace
  window, then stops (the school pays from Plan & billing). Paying reactivates
  everything at once.
- **Platform console**: each school's card, subscription status, failures,
  recent EduCore invoices, and any payment needing review.
- Paystack callback `/api/billing/paystack/callback`; the existing webhook now
  routes `ECB-…` references to subscription billing.
- Assumptions (stated): no proration on upgrades; minimum one billable
  student; EduCore invoices are in naira whatever the school's currency.

### Security (milestone 4.2)

- Migration `0019_subscription_billing` (additive): `platform_invoices` and
  `platform_payments` (platform-only: RLS forced, revoked from `educore_app`);
  CHECKs: amount = students × price, paid ⇔ paid date, reference format;
  unique: one live invoice per school per month, one successful payment per
  invoice, unique references.
- Migration `0020_subscription_lockdown`: subscriptions (which now hold the
  card authorization) are no longer readable by school sessions at all.
- The card authorization never leaves the server: not in page data, not in
  either audit log (added to the audit redaction list).
- Only school admins (`subscription:update`) can pay or change plan — never
  EduCore support while signed in as them. A read-only school can still pay.
- Money counts only after Paystack confirms server to server; settlement
  locks the payment row and is idempotent (return page, webhook, job). A
  renewal that got no answer is checked, never charged blind a second time;
  two job runs can't charge a school twice. Mismatched or late payments go to
  review, never onto the subscription.
- Every payment, failure, plan change and auto-renew change is in the platform
  audit log; school-side changes also in the school's audit log.
- Tests: 11 billing-rule unit tests, RBAC test, entitlement test (read-only
  can pay), 12 integration tests (checkout keeps trial days and saves the
  card; idempotent settle; review on mismatch; upgrade/downgrade/undo;
  concurrent renewals charge once; decline → retries → read-only; pay to
  reactivate; no-answer never double-charges; auto-renew off → cancelled;
  isolation of invoices; no card token in data or audits; DB constraints).

### Added (milestone 4.1 — plans, limits and feature flags, 2026-10-05)

- **Plan catalogue** (`plans` table, edited at `/platform/plans`): name, price
  per active student per month (naira), student limit, modules included,
  shown/hidden. Placeholders: Free trial (all modules, 500 students), Starter
  ₦300 (attendance, assessments, timetable, messaging; 300), Standard ₦500
  (+ report cards, fees; 1,500), Premium ₦800 (+ online payment; no limit).
- **Modules enforced on the server**: attendance, assessments, report cards,
  timetable, fees, online payments, messaging. Outside the plan, the menu
  hides it, its pages open "Your plan" explaining what's needed, and every
  action, PDF and export refuses with a friendly upgrade message. Core
  features (people, academics, imports, settings, audit) are on every plan.
- **Student limit**: enforced on add, re-activation and CSV import (row by
  row: existing students still update; new ones past the limit are reported).
  Withdrawn and graduated students don't count.
- **Subscription states**: 30-day free trial → paid; after the paid period
  ends or a payment fails, 7 days' grace (everything works, warning banner),
  then **read-only** (everyone can view and export; nothing can change) until
  renewed. Suspended schools stay locked out.
- **Your plan** (`/plan`, school admins in the menu; anyone sent there): plan,
  state and dates, students used against the limit, monthly cost now, modules,
  and the public plans with an estimate for this school's size.
- **Banners**: trial countdown (admins), grace and read-only (everyone).
- **Platform console**: change a school's plan by hand with a reason
  (complimentary, paid offline, trial extension, paid-until date); the
  school's state shows on its page. Audited as `TENANT_PLAN_CHANGE` /
  `PLAN_UPDATE` in the platform log, and in the school's own log.
- Greenfield Academy (demo) is on complimentary Premium with no end date.

### Security (milestone 4.1)

- Migration `0018_plans` (additive): platform-only `plans` table (RLS forced,
  all privileges revoked from `educore_app`), CHECKs on price, limit and
  module names.
- `requirePermission` now checks RBAC **and** the plan; the routes that check
  RBAC themselves (invoice/receipt/report-card PDFs, exports, imports) call
  `assertEntitled`. Platform admins aren't on a plan; support impersonation is.
- The student limit takes a per-school advisory lock, so two enrolments at the
  same moment can't both take the last place.
- Tests: 13 entitlement unit tests, 3 navigation tests, 7 integration tests
  (catalogue → entitlements, schools can't read/write plans, DB CHECKs, lapsed
  trial read-only, concurrent last-place race, import limit, withdrawn frees a
  place).

### Added (milestone 4.0 — platform admin console, 2026-10-05)

- **Schools** (`/platform/tenants`, platform admins): every school with plan
  (and trial days left), status, active students, staff, last activity and
  join date; search (name, short name or any user's email), status and plan
  filters, sorting, pagination, CSV/Excel export.
- **School page**: status, plan, students, staff/parents, fees collected;
  school admins; setup checklist progress; recent activity (support actions
  flagged); support-session history.
- **Suspend / reactivate** a school with a reason (everyone there is signed
  out; data kept); live support sessions in that school end at once.
- **Sign in as a school admin for support**: reason required (the school can
  see it), 30 minutes then it stops by itself, a banner on every page with
  "Stop and return to console", one live session per platform admin. While
  signed in as them: no invite links (they set passwords) — billing joins this
  list in 4.2.
- **Platform activity** (`/platform/audit`): every suspension, reactivation
  and support sign-in/out; append-only.
- Schools' own audit log shows "via EduCore support" on anything done during
  a support session, and records each session start and end.

### Security (milestone 4.0)

- Migration `0017_platform_console` (additive): `platform_audit_logs`
  (append-only by trigger, like `audit_logs`) and `impersonation_sessions`
  (window ≤ 2 hours by CHECK), both with RLS forced and no grants for the app
  role — school sessions can't read or write them; `audit_logs.impersonatorId`;
  `tenants.suspendedAt/suspendedReason`.
- The impersonation cookie is httpOnly and HMAC-signed with an expiry, but it
  only points at a session row: every request re-checks the row is open,
  unexpired, started by THIS platform admin, and that the admin and school are
  still active. While impersonating, the request is the school admin's in every
  respect (tenant-scoped client, RLS, RBAC) — platform powers are off.
- Tests: token signing (4 unit); **7 integration tests on real Postgres**
  (who can be impersonated, both audit trails, other platform admin / expired /
  forged cookie refused, new session ends the old one, stop, deactivation cuts
  it off, platform tables hidden from school sessions, platform log append-only).

## Phase 3 — Fees & payments (2026-10-04)

Spec: `claude/phase-3-spec.md` (confirmed 2026-10-02): billed per term;
discounts per student (% or fixed, whole bill or one item); optional items
opt-in per student per term; parents pay online with **Paystack** (test
mode) in 3.3, alongside bursar-recorded cash/transfer/POS/cheque payments.

### Added (milestone 3.3 — online payments, families and reports, 2026-10-04)

- **Fees for families** (`/fees` for parents and students): each child's
  invoices with what's owed, paid and due, invoice PDFs and recent receipts.
- **Pay online with Paystack** (parents): full or part of the balance
  (minimum ₦100) → Paystack's secure checkout (card, transfer, USSD) → back to
  the invoice with the outcome. The payment, receipt number and receipt PDF
  appear as soon as Paystack confirms it; it shows in Payments as "Paystack
  (online)", recorded by the parent.
- **Confirmed only by Paystack itself**: the return page and the webhook
  (`/api/webhooks/paystack`, HMAC-SHA512 signature required) only prompt a
  server-to-server check of the reference; nothing in a URL or body is
  trusted. Settling is idempotent — return page + webhook + "check again"
  record the money once.
- **Needs attention** (Payments page, bursar): online payments taken but not
  applied (amount/currency mismatch, invoice settled at the bursary
  meanwhile — never overpaid) and checkouts unconfirmed after 30 minutes,
  with **Check again**.
- **Reports** (`/fees/reports`): term totals, by class (billed, collected,
  outstanding, %), by payment method, money in over the last 30 days (bar
  chart with an accessible table), the 15 largest balances; **debtors
  export** (CSV/Excel) with parents' contacts for follow-up.
- `PAYSTACK_SECRET_KEY` (test) set in Vercel by Kunle; without it parents
  simply don't see "Pay online".
- ASSUMPTIONS: one Paystack account (from the environment) for the demo —
  per-school keys or Paystack subaccounts come with the platform admin in
  Phase 4, so each school's money goes to its own account. Paystack's
  transaction fee is borne by the school (not added to the parent's amount).
  Email reminders to debtors wait for Resend (parked); the debtors export
  covers follow-up for now.

### Security (milestone 3.3)

- Migration `0016_online_payments` (additive): `online_payments` with forced
  RLS, the provider reference unique across schools (how a session-less
  webhook finds its school), at most one Payment per attempt, SUCCEEDED ⇔
  linked payment (CHECK), no DELETE for the app role.
- The attempt row is locked while settling; the return URL only ever points
  at our own hosts; references are random (`EDU-` + 80 bits) and anything
  else is ignored.
- Fixed before release: parents hold `payment:create` (for online checkout),
  so the bursary "record payment" action now also requires finance-staff
  rights — a family can never mark its own invoice paid.
- Tests: settlement rules, signature check and amount checks (9 unit tests);
  **8 integration tests against a real Postgres with a fake Paystack**
  (checkout recorded first, paid once however often confirmed, return page +
  webhook racing, amount mismatch → review, failed/abandoned, invoice settled
  meanwhile → review not overpayment, unknown references, tenant isolation
  and no deletes); RBAC test for who can pay online.

### Added (milestones 3.1 invoicing and 3.2 payments & receipts, 2026-10-02)

- **Invoices** (`/fees`, now the first Fees tab): per-term totals (billed,
  collected with collection rate, outstanding, overdue) and a list with
  search (invoice no., student, admission no.), class and status filters
  (not fully paid, overdue, unpaid, part paid, paid, cancelled), sorting,
  pagination and CSV/Excel export.
- **Bill the term** (`/fees/billing`): per class, students, already billed,
  to bill and the amount — worked out exactly as the invoices will be —
  then a due date and one confirmation. Runs in the background (Inngest,
  50 students per step) with live progress; re-running only bills students
  who still have no invoice for the term, so it's safe after admissions.
- **Invoice page**: lines (fees, "Less:" discounts, adjustments), total, paid,
  balance; payments with receipts; **add adjustment** (extra charge, or a
  credit with a minus sign); **cancel** (only with nothing paid, reason
  required — the student can then be billed again); **invoice PDF**.
- **Record payment** (bursar): amount (defaults to the balance), date, cash /
  bank transfer / POS / cheque, reference (required except for cash), note.
  Never more than the balance; a reference already recorded is refused.
  Every payment gets a **receipt number** (`RCT-2026-00001`) and a
  **receipt PDF** (A5).
- **Reverse a payment** (bounced transfer, mistake): reason required; the
  original stays, a reversal row is added, the balance goes back up.
- **Payments** (`/payments`): every payment and reversal for today / this
  week / this month / all time with the net total, search, method filter,
  export; **bank-statement import** (CSV: amount, date, reference, invoice
  no. or admission no. — the oldest unpaid invoice is used), with the usual
  validation report; a re-imported statement never pays twice.
- Invoice numbers `INV-2026-00001` and receipt numbers per school and year,
  gap-free; prefixes are school settings (`invoicePrefix`, `receiptPrefix`),
  default due date = term start (or today) + `paymentTermDays` (14).
- Student profile: **Fees** card (balance owed, recent invoices) for finance
  staff and admins. Dashboards: admin — fees collected this term "X of Y";
  bursar — collected this term, outstanding, overdue, collected today;
  parent — fees due is now the real outstanding balance.
- DECISION (segregation of duties): school admins see every payment but only
  the bursar (ACCOUNTANT) records, reverses or imports payments. One-line
  change in `packages/auth/src/permissions.ts` if a school wants otherwise.
- ASSUMPTIONS: overpayment isn't accepted on an invoice (a family paying
  two invoices records two payments); student credit balances come with
  online payments in 3.3. Invoices are issued directly (no draft step) —
  the billing preview is the review; a wrong invoice is cancelled and re-billed.
- Greenfield demo: the 11 unpaid pre-Phase-3 tuition-only demo invoices were
  cancelled (audited) so First term can be billed from the schedule; the one
  paid example stays as history.

### Security (milestones 3.1 / 3.2)

- Migration `0015_invoices_payments` (additive): invoices gain term, discount
  total, amount paid, cancellation, billing run; **one live invoice per
  student per term** (partial unique index); money CHECKs (paid ≤ total,
  cancelled ⇒ nothing paid); invoice lines carry kind / fee item / discount;
  payments gain kind (PAYMENT / REVERSAL), student, reversal link (once),
  recorder; **payments are append-only for the app role** (UPDATE and
  DELETE revoked); `number_sequences` and `billing_runs` with forced RLS.
- Money changes lock the invoice row first (`SELECT … FOR UPDATE`): two
  bursars paying the same balance at once — exactly one succeeds (tested).
- Invoice and receipt PDFs and the invoice page use the student row scope
  (ready for parents in 3.3); other families' ids answer 404.
- Tests: `lib/invoicing.ts` (12 unit tests); **22 integration tests against
  a real Postgres** (`invoicing.integration.test.ts`): billing maths, gap-free
  numbers, no double billing (also across re-runs), one-off items once,
  payments/receipts, overpayment and future-date refusal, concurrent
  payments, reversal once, append-only payments, adjustments, cancellation and
  re-billing, statement import (balances across rows, duplicates, re-import),
  and tenant isolation for invoices, payments, counters and billing runs.
  The `packages/db` tenant-isolation suite now also runs locally (29 passing).
  RBAC tests for invoices and payments.

### Added (milestone 3.0 — fee setup, 2026-10-02)

- **Fees** area for school admins and accountants (`/fees`), five tabs:
  - **Fee items** — what the school charges for, in invoice order; optional
    (bus, lunch) and one-off (admission fee) flags; deactivate instead of
    deleting once billed.
  - **Fee schedule** — one grid per term: items down, classes across, type
    each class's amount; blank = not charged; live totals per student
    (compulsory, plus optional). **Copy from another term** (classes matched
    by name, so next year can start from this year's fees). Terms of the
    active year and the next year are offered.
  - **Discounts** — named % or fixed discounts, for the whole bill or one
    item (e.g. Staff child 50% off tuition); give them to students for one
    term or the whole year, with a note.
  - **Optional items** — tick-list of a class's students signed up for an
    item in a term.
  - **Bill preview** — exactly what a student would be charged for a term,
    with discount lines and why any item was left out.
- **Fee maths** (`lib/fees.ts`, 19 tests): integer minor units only (no
  floats); discounts never compound (each works on its own base), item
  discounts first, never below zero; one-off items billed once.
- Demo bursar login (`bursar@greenfield.edu`, ACCOUNTANT).
- Greenfield demo: 6 fee items; schedule for all three terms (Grade 5
  ₦150,000 / Grade 6 ₦165,000 tuition, levy, books in first term, bus and
  lunch); Sibling 10%, Staff child 50% tuition, Merit ₦75,000; three
  students with discounts; seven bus/lunch sign-ups.
- ASSUMPTION: Paystack replaces Stripe for school-fee collection only;
  Stripe stays for EduCore's own subscriptions (Phase 4).

### Security (milestone 3.0)

- Migration `0014_fee_setup` (additive): `discounts`, `student_discounts`,
  `fee_signups` with **forced RLS** (verified live: other school's rows
  invisible, cross-school insert refused); fee item names unique per
  school; non-negative amounts; percentages ≤ 100; one schedule amount per
  item/class/term; a term with fees or discounts can't be deleted.
- Every fee-setup change is audited (FeeType, FeeSchedule with each changed
  cell, Discount, StudentDiscount, FeeSignup). Every id from the browser is
  re-checked against the school; schedule cells must belong to the term's
  year.
- Tests: RBAC (only admins/accountants manage fees; accountants still
  can't touch academics); tenant-isolation test for the three new tables.

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
