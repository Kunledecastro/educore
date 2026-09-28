import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import type { ImportStatus } from "@educore/db";

const VARIANT: Record<ImportStatus, "secondary" | "warning" | "success" | "destructive" | "outline"> = {
  VALIDATED: "outline",
  QUEUED: "secondary",
  IMPORTING: "secondary",
  COMPLETED: "success",
  FAILED: "destructive",
  CANCELLED: "warning",
};

export async function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const t = await getTranslations("imports.statuses");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
