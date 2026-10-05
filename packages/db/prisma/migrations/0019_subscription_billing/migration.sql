-- Phase 4.2: EduCore's own subscription billing via Paystack (naira).
-- Platform-level tables: schools never query them directly; the server
-- reads them with the platform client, always filtered by the session's school.

ALTER TABLE "subscriptions"
  ADD COLUMN "pendingPlan" "Plan",
  ADD COLUMN "billingEmail" TEXT,
  ADD COLUMN "paystackAuthorizationCode" TEXT,
  ADD COLUMN "paystackCustomerCode" TEXT,
  ADD COLUMN "cardBrand" TEXT,
  ADD COLUMN "cardLast4" TEXT,
  ADD COLUMN "cardExpiry" TEXT,
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextChargeAt" TIMESTAMP(3),
  ADD COLUMN "lastChargeError" TEXT;

CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');
CREATE TYPE "PlatformPaymentKind" AS ENUM ('CHECKOUT', 'RENEWAL');
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'NEEDS_REVIEW');

CREATE SEQUENCE "platform_invoice_no_seq";

CREATE TABLE "platform_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT ('ECI-' || lpad(nextval('platform_invoice_no_seq')::text, 6, '0')),
    "plan" "Plan" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "students" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "platform_invoices_period" CHECK ("periodEnd" > "periodStart"),
    CONSTRAINT "platform_invoices_amount" CHECK ("students" > 0 AND "unitPriceMinor" > 0 AND "amountMinor" = "students" * "unitPriceMinor"),
    CONSTRAINT "platform_invoices_paid" CHECK (("status" = 'PAID') = ("paidAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "platform_invoices_number_key" ON "platform_invoices"("number");
CREATE INDEX "platform_invoices_tenantId_idx" ON "platform_invoices"("tenantId", "periodStart");
-- A billing period is invoiced once: never two live invoices for the same school and period.
CREATE UNIQUE INDEX "platform_invoices_one_live_per_period" ON "platform_invoices"("tenantId", "periodStart") WHERE "status" <> 'VOID';

CREATE TABLE "platform_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "PlatformPaymentKind" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "channel" TEXT,
    "message" TEXT,
    "initiatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "platform_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "platform_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "platform_payments_reference_format" CHECK ("reference" ~ '^ECB-[0-9a-f]{20}$'),
    CONSTRAINT "platform_payments_amount" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "platform_payments_reference_key" ON "platform_payments"("reference");
CREATE INDEX "platform_payments_invoiceId_idx" ON "platform_payments"("invoiceId");
-- At most one successful payment per invoice.
CREATE UNIQUE INDEX "platform_payments_one_success" ON "platform_payments"("invoiceId") WHERE "status" = 'SUCCEEDED';

ALTER TABLE "platform_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_invoices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_payments" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educore_app') THEN
    REVOKE ALL ON "platform_invoices", "platform_payments" FROM educore_app;
    REVOKE ALL ON SEQUENCE "platform_invoice_no_seq" FROM educore_app;
  END IF;
END $$;
