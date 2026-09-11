-- Defense-in-depth layer #2 (architecture rule #1): PostgreSQL Row Level
-- Security on every tenant-owned table, keyed on the session variable
-- `app.tenant_id`. This backs up the Prisma-level `forTenant()` scoping in
-- packages/db/src/tenant-scope.ts (layer #1) — even a raw SQL query, a bug
-- in the Prisma extension, or a future service that talks to this database
-- directly still cannot cross a tenant boundary.
--
-- CAVEAT (documented, not glossed over — see packages/db/src/rls.ts for the
-- full explanation): RLS policies are bypassed for the table owner unless
-- FORCE ROW LEVEL SECURITY is set (done below) AND the connecting role is
-- NOT a superuser — Postgres superusers always bypass RLS regardless of
-- FORCE. Neon/Supabase's default connection role is typically the owning
-- role but NOT a Postgres superuser, so FORCE ROW LEVEL SECURITY below is
-- sufficient in both; double-check this for any other Postgres host. See
-- DEPLOYMENT.md for how to verify.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'academic_years', 'class_grades', 'sections', 'subjects',
    'class_section_subjects', 'students', 'guardians', 'student_guardians',
    'teachers', 'staff', 'attendance', 'assessment_types', 'assessments',
    'marks', 'report_cards', 'timetable_entries', 'announcements',
    'message_threads', 'messages', 'fee_types', 'fee_structures', 'invoices',
    'invoice_lines', 'payments', 'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;
END $$;

-- message_threads has no direct tenantId-only policy exception needed (it
-- already carries tenantId, included in the loop above).

-- Platform-level tables (tenants, subscriptions, accounts,
-- verification_tokens) intentionally have NO row level security: they are
-- either the tenant boundary itself or platform-admin-only.
