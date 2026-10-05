-- Phase 4.2: subscriptions now hold a reusable card authorization. Schools'
-- sessions never needed this table (the server reads it with the platform
-- client), so the 0004 self-read exception is removed: default-deny.
DROP POLICY IF EXISTS subscription_self_read ON subscriptions;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE ALL ON "subscriptions" FROM educore_app;
  END IF;
END $$;
