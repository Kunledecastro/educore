"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { ConfirmAction } from "@/components/form/confirm-action";
import { STAFF_IDLE_CHOICES } from "@/lib/security/session-limits";
import { resetUserTwoFactorAction, saveSchoolSecurityAction } from "../security-actions";

export function TeacherRequirementForm({ initial }: { initial: boolean }) {
  const t = useTranslations("twoFactor.school");
  const router = useRouter();
  const [on, setOn] = React.useState(initial);
  const [pending, start] = React.useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={on} onChange={(e) => setOn(e.target.checked)} />
        {t("requireTeachers")}
      </label>
      <Button
        type="button"
        size="sm"
        disabled={pending || on === initial}
        onClick={() =>
          start(async () => {
            const r = await saveSchoolSecurityAction({ requireTeacher2fa: on });
            if (r.ok) {
              toast.success(t("saved"));
              router.refresh();
            } else toast.error(r.error);
          })
        }
      >
        {t("save")}
      </Button>
    </div>
  );
}

/** Staff inactivity sign-out (tester review, Oct 2026). */
export function IdleTimeoutForm({ initial }: { initial: number }) {
  const t = useTranslations("sessionSecurity");
  const router = useRouter();
  const [minutes, setMinutes] = React.useState(initial);
  const [pending, start] = React.useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="idle-minutes" className="text-sm">
        {t("staffIdleLabel")}
      </label>
      <select id="idle-minutes" className="h-9 rounded-md border bg-background px-2 text-sm" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
        {STAFF_IDLE_CHOICES.map((m) => (
          <option key={m} value={m}>
            {t("minutes", { count: m })}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        disabled={pending || minutes === initial}
        onClick={() =>
          start(async () => {
            const r = await saveSchoolSecurityAction({ staffIdleMinutes: minutes });
            if (r.ok) {
              toast.success(t("saved"));
              router.refresh();
            } else toast.error(r.error);
          })
        }
      >
        {t("save")}
      </Button>
    </div>
  );
}

export function ResetTwoFactorButton({ userId, name }: { userId: string; name: string }) {
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
      action={() => resetUserTwoFactorAction(userId)}
      successMessage={t("resetDone")}
      onSuccess={() => router.refresh()}
    />
  );
}
