-- Phase 3, milestones 3.1 (invoicing) and 3.2 (payments & receipts). Additive.
--
-- Invoices
--   * termId: invoices are per term; at most ONE live (not cancelled) invoice
--     per student per term (partial unique index) — a retried billing run
--     can never double-bill.
--   * totalDue = the invoice total (subtotal − discountTotal + adjustments);
--     amountPaid = sum of its payments (net of reversals), kept in step by the
--     app in the same transaction as every payment. Balance = totalDue − amountPaid.
-- Invoice lines: kind FEE / DISCOUNT (negative) / ADJUSTMENT, with the fee
--   item and discount they came from.
-- Payments are append-only: the app role may INSERT and SELECT but never
--   UPDATE or DELETE them. A mistake is undone by a REVERSAL row (negative
--   amount) that points at the payment it reverses (once).
-- number_sequences: per-school counters for invoice/receipt numbers,
--   incremented inside the write transaction, so numbers are gap-free.
-- billing_runs: one background "bill the term" run, with progress.

-- ---------------------------------------------------------------- invoices
ALTER TABLE "invoices" ADD COLUMN "termId"        TEXT;
ALTER TABLE "invoices" ADD COLUMN "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "amountPaid"    DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "cancelledAt"   TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "cancelReason"  TEXT;
ALTER TABLE "invoices" ADD COLUMN "billingRunId"  TEXT;
ALTER TABLE "invoices" ADD COLUMN "createdById"   TEXT;
ALTER TABLE "invoices" ADD COLUMN "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Older (pre-Phase 3) rows: totalDue held the balance; make it the invoice total.
UPDATE "invoices" i SET
  "amountPaid" = COALESCE((SELECT SUM(p.amount) FROM "payments" p WHERE p."invoiceId" = i.id), 0),
  "totalDue"   = i.subtotal;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_check" CHECK (
  "subtotal" >= 0 AND "discountTotal" >= 0 AND "totalDue" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "totalDue");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancel_check" CHECK (
  ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL) AND ("status" <> 'CANCELLED' OR "amountPaid" = 0));
CREATE UNIQUE INDEX "invoices_one_live_per_student_term"
  ON "invoices" ("tenantId", "studentId", "termId") WHERE "status" <> 'CANCELLED' AND "termId" IS NOT NULL;
CREATE INDEX "invoices_tenantId_termId_status_idx" ON "invoices" ("tenantId", "termId", "status");
CREATE INDEX "invoices_tenantId_studentId_idx" ON "invoices" ("tenantId", "studentId");

-- ----------------------------------------------------------- invoice lines
ALTER TABLE "invoice_lines" ADD COLUMN "kind"       TEXT NOT NULL DEFAULT 'FEE';
ALTER TABLE "invoice_lines" ADD COLUMN "feeTypeId"  TEXT;
ALTER TABLE "invoice_lines" ADD COLUMN "discountId" TEXT;
ALTER TABLE "invoice_lines" ADD COLUMN "position"   INTEGER NOT NULL DEFAULT 0;
UPDATE "invoice_lines" l SET "feeTypeId" = s."feeTypeId" FROM "fee_structures" s WHERE s.id = l."feeStructureId";
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_kind_check" CHECK (
  ("kind" = 'FEE' AND "amount" >= 0) OR ("kind" = 'DISCOUNT' AND "amount" <= 0) OR "kind" = 'ADJUSTMENT');
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_feeTypeId_fkey"
  FOREIGN KEY ("feeTypeId") REFERENCES "fee_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_discountId_fkey"
  FOREIGN KEY ("discountId") REFERENCES "discounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "invoice_lines_tenantId_invoiceId_idx" ON "invoice_lines" ("tenantId", "invoiceId");

-- ---------------------------------------------------------------- payments
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'POS';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CHEQUE';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'PAYSTACK';
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REVERSAL');

ALTER TABLE "payments" ADD COLUMN "kind"         "PaymentKind" NOT NULL DEFAULT 'PAYMENT';
ALTER TABLE "payments" ADD COLUMN "studentId"    TEXT;
ALTER TABLE "payments" ADD COLUMN "note"         TEXT;
ALTER TABLE "payments" ADD COLUMN "reversesId"   TEXT;
ALTER TABLE "payments" ADD COLUMN "recordedById" TEXT;
ALTER TABLE "payments" ADD COLUMN "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "payments" p SET "studentId" = i."studentId" FROM "invoices" i WHERE i.id = p."invoiceId";
ALTER TABLE "payments" ALTER COLUMN "studentId" SET NOT NULL;
ALTER TABLE "payments" ADD CONSTRAINT "payments_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversesId_fkey"
  FOREIGN KEY ("reversesId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind_check" CHECK (
  ("kind" = 'PAYMENT' AND "amount" > 0 AND "reversesId" IS NULL) OR
  ("kind" = 'REVERSAL' AND "amount" < 0 AND "reversesId" IS NOT NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payments_note_check" CHECK ("note" IS NULL OR length("note") <= 300);
CREATE UNIQUE INDEX "payments_reversesId_key" ON "payments" ("reversesId");
CREATE UNIQUE INDEX "payments_tenantId_receiptNo_key" ON "payments" ("tenantId", "receiptNo") WHERE "receiptNo" IS NOT NULL;
CREATE INDEX "payments_tenantId_paidAt_idx" ON "payments" ("tenantId", "paidAt");
CREATE INDEX "payments_tenantId_invoiceId_idx" ON "payments" ("tenantId", "invoiceId");
CREATE INDEX "payments_tenantId_studentId_idx" ON "payments" ("tenantId", "studentId");

-- Append-only for the application.
REVOKE UPDATE, DELETE ON "payments" FROM educore_app;

-- -------------------------------------------------------- number sequences
CREATE TABLE "number_sequences" (
  "tenantId" TEXT NOT NULL,
  "key"      TEXT NOT NULL,
  "value"    INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("tenantId", "key"),
  CONSTRAINT "number_sequences_value_check" CHECK ("value" >= 0)
);
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------ billing runs
CREATE TYPE "BillingRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TABLE "billing_runs" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "termId"      TEXT NOT NULL,
  "classIds"    JSONB NOT NULL DEFAULT '[]',
  "dueDate"     DATE NOT NULL,
  "status"      "BillingRunStatus" NOT NULL DEFAULT 'QUEUED',
  "total"       INTEGER NOT NULL DEFAULT 0,
  "done"        INTEGER NOT NULL DEFAULT 0,
  "created"     INTEGER NOT NULL DEFAULT 0,
  "skipped"     INTEGER NOT NULL DEFAULT 0,
  "amount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "error"       TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"  TIMESTAMP(3),
  CONSTRAINT "billing_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "billing_runs_tenantId_idx" ON "billing_runs" ("tenantId");
CREATE INDEX "billing_runs_tenantId_termId_createdAt_idx" ON "billing_runs" ("tenantId", "termId", "createdAt");
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billingRunId_fkey"
  FOREIGN KEY ("billingRunId") REFERENCES "billing_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['number_sequences', 'billing_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = current_setting('app.tenant_id', true))
      WITH CHECK ("tenantId" = current_setting('app.tenant_id', true))$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON "number_sequences" TO educore_app;
GRANT SELECT, INSERT, UPDATE ON "billing_runs" TO educore_app;
REVOKE DELETE ON "number_sequences", "billing_runs" FROM educore_app;
-- Ensure the new import kind exists for bank-statement payment imports.
ALTER TYPE "ImportKind" ADD VALUE IF NOT EXISTS 'PAYMENTS';
