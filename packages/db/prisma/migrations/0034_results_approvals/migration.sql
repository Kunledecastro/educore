-- Phase 8.1: academic approvals. Publishing and unpublishing a class's
-- results can now be approval requests.
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_process";
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_process"
  CHECK ("process" IN ('DISCOUNT_ASSIGN', 'DISCOUNT_RULE', 'INVOICE_CANCEL', 'PAYMENT_REVERSAL', 'RESULTS_PUBLISH', 'RESULTS_UNPUBLISH'));
