"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@educore/ui/badge";
import type { InvoiceDisplayStatus } from "@/lib/invoicing";

const VARIANT: Record<InvoiceDisplayStatus, "default" | "secondary" | "destructive" | "success" | "warning" | "outline"> = {
  ISSUED: "secondary",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "destructive",
  CANCELLED: "outline",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  const t = useTranslations("fees.invoiceStatus");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
