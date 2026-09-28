"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@educore/ui/badge";
import type { InviteStatus } from "@/lib/invite-token";

const VARIANT: Record<InviteStatus, "success" | "secondary" | "warning" | "outline" | "destructive"> = {
  active: "success",
  invited: "secondary",
  expired: "warning",
  notInvited: "outline",
  deactivated: "destructive",
};

export function AccountStatusBadge({ status }: { status: InviteStatus }) {
  const t = useTranslations("people.status");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
