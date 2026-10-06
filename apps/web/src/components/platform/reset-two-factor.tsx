"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { ConfirmAction } from "@/components/form/confirm-action";
import { platformResetTwoFactorAction, setTwoFactorExemptAction } from "@/app/(app)/platform/actions";

/** Platform team: reset a school admin's 2FA after a lost phone (Phase 6.0). */
export function PlatformResetTwoFactor({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations("twoFactor.school");
  const router = useRouter();
  return (
    <ConfirmAction
      trigger={
        <Button type="button" variant="ghost" size="sm">
          {t("reset")}
        </Button>
      }
      title={t("resetTitle", { name })}
      description={t("resetDescription")}
      confirmLabel={t("reset")}
      action={() => platformResetTwoFactorAction(userId)}
      successMessage={t("resetDone")}
      onSuccess={() => router.refresh()}
    />
  );
}

/** Platform team: mark a shared demo school as not requiring 2FA. */
export function TwoFactorExemptToggle({ tenantId, exempt, school }: { tenantId: string; exempt: boolean; school: string }) {
  const t = useTranslations("platform.tenant");
  const router = useRouter();
  return (
    <ConfirmAction
      trigger={
        <Button type="button" variant="outline" size="sm">
          {exempt ? t("exemptOff") : t("exemptOn")}
        </Button>
      }
      title={exempt ? t("exemptOffTitle", { school }) : t("exemptOnTitle", { school })}
      description={exempt ? t("exemptOffDescription") : t("exemptOnDescription")}
      confirmLabel={exempt ? t("exemptOff") : t("exemptOn")}
      destructive={!exempt}
      action={() => setTwoFactorExemptAction(tenantId, !exempt)}
      successMessage={t("saved")}
      onSuccess={() => router.refresh()}
    />
  );
}
