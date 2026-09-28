-- Audit log is append-only (architecture rule #3). The `audit_logs_immutable`
-- trigger already rejects UPDATE/DELETE for everyone; the tenant role also
-- simply doesn't hold those privileges, so an attempt fails at the
-- permission check before any trigger runs.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM educore_app;
