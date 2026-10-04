-- Phase 3, milestone 3.3: online payments (Paystack). Additive.
--
-- online_payments: one row per checkout a parent starts. The provider
-- reference is unique across ALL schools (it's how a webhook, which arrives
-- with no session, finds its school). A row becomes SUCCEEDED only after
-- server-side verification with the provider, and then points at the
-- Payment it created — at most one (paymentId unique), so a webhook and a
-- browser redirect arriving together can't record the money twice.
-- NEEDS_REVIEW = money was taken but couldn't be applied (e.g. the invoice
-- was settled at the bursary meanwhile); the bursar decides.

CREATE TYPE "OnlinePaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'NEEDS_REVIEW');

CREATE TABLE "online_payments" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "invoiceId"   TEXT NOT NULL,
  "studentId"   TEXT NOT NULL,
  "payerId"     TEXT,
  "provider"    TEXT NOT NULL DEFAULT 'paystack',
  "reference"   TEXT NOT NULL,
  "amount"      DECIMAL(12,2) NOT NULL,
  "currency"    TEXT NOT NULL,
  "status"      "OnlinePaymentStatus" NOT NULL DEFAULT 'PENDING',
  "channel"     TEXT,
  "message"     TEXT,
  "paymentId"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt"  TIMESTAMP(3),
  CONSTRAINT "online_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "online_payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "online_payments_paid_check" CHECK (("status" = 'SUCCEEDED') = ("paymentId" IS NOT NULL))
);
CREATE UNIQUE INDEX "online_payments_reference_key" ON "online_payments" ("reference");
CREATE UNIQUE INDEX "online_payments_paymentId_key" ON "online_payments" ("paymentId");
CREATE INDEX "online_payments_tenantId_idx" ON "online_payments" ("tenantId");
CREATE INDEX "online_payments_tenantId_invoiceId_idx" ON "online_payments" ("tenantId", "invoiceId");
CREATE INDEX "online_payments_tenantId_status_idx" ON "online_payments" ("tenantId", "status");
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_payerId_fkey"
  FOREIGN KEY ("payerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "online_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "online_payments"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE ON "online_payments" TO educore_app;
REVOKE DELETE ON "online_payments" FROM educore_app;
