import type { TenantSettings } from "../tenant-settings";
import { formatMoney } from "../format";
import type { ApprovalProcess } from "./policy";
import type { Summary } from "./processes";

type T = (key: string, values?: Record<string, string | number>) => string;

/** "10%" or "₦20,000" from a stored "PERCENT:10.00" / "FIXED:20000.00". */
export function discountValueText(v: string | undefined, settings: Pick<TenantSettings, "locale" | "currency" | "timezone" | "dateStyle">): string {
  if (!v) return "";
  const [kind, raw] = v.split(":");
  const n = Number(raw);
  return kind === "PERCENT" ? `${Number.isFinite(n) ? Number(n.toFixed(2)) : raw}%` : formatMoney(raw, settings);
}

/** One readable line for a request, e.g. "Cancel invoice INV-2026-0012 · Ada Obi". */
export function headline(t: T, process: ApprovalProcess, s: Summary): string {
  switch (process) {
    case "DISCOUNT_ASSIGN":
      return t("headline.DISCOUNT_ASSIGN", { discount: s.discount ?? "", pupil: s.pupil ?? "" });
    case "INVOICE_CANCEL":
      return t("headline.INVOICE_CANCEL", { invoice: s.invoiceNo ?? "", pupil: s.pupil ?? "" });
    case "PAYMENT_REVERSAL":
      return t("headline.PAYMENT_REVERSAL", { receipt: s.receiptNo ?? "—", pupil: s.pupil ?? "" });
    case "DISCOUNT_RULE":
      return t(s.ruleChange === "update" ? "headline.DISCOUNT_RULE_update" : "headline.DISCOUNT_RULE_create", { discount: s.discount ?? "" });
  }
}

export const STATUS_VARIANT: Record<string, "warning" | "success" | "destructive" | "secondary" | "outline"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
  FAILED: "destructive",
  WITHDRAWN: "secondary",
  EXPIRED: "outline",
};
