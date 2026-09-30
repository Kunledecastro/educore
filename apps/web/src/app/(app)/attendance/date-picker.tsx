"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Day picker for registers: previous / date / next, via `?date=`. Can't go past today. */
export function DatePicker({ value, min, max }: { value: string; min: string; max: string }) {
  const t = useTranslations("attendance");
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = React.useTransition();
  const go = (iso: string) => startTransition(() => router.replace(`${pathname}?date=${iso}`));
  const id = React.useId();

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={() => go(shift(value, -1))} disabled={value <= min} aria-label={t("previousDay")}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <label htmlFor={id} className="sr-only">
        {t("date")}
      </label>
      <Input
        id={id}
        type="date"
        className="w-auto"
        value={value}
        min={min}
        max={max}
        onChange={(e) => e.target.value && go(e.target.value)}
      />
      <Button variant="outline" size="icon" onClick={() => go(shift(value, 1))} disabled={value >= max} aria-label={t("nextDay")}>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      {value !== max ? (
        <Button variant="ghost" size="sm" onClick={() => go(max)}>
          {t("today")}
        </Button>
      ) : null}
    </div>
  );
}
