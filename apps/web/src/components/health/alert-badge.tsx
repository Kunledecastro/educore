"use client";

import * as React from "react";
import { HeartPulse } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@educore/ui/utils";

export interface BadgeAlert {
  category: string;
  severity: "MILD" | "MODERATE" | "SEVERE";
  text: string;
}

/**
 * A small health-alert marker next to a pupil's name (registers, gradebooks,
 * class lists). Tap or click to read the nurse's alerts. Colour plus the
 * word "Severe" — never colour alone.
 */
export function HealthAlertBadge({ name, alerts }: { name: string; alerts?: BadgeAlert[] }) {
  const t = useTranslations("health.alerts");
  const [open, setOpen] = React.useState(false);
  // Fixed position so the panel isn't clipped by scrolling tables (gradebooks).
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = React.useRef<HTMLSpanElement>(null);
  const id = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const hide = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);
  if (!alerts?.length) return null;
  const severe = alerts.some((a) => a.severity === "SEVERE");
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("badgeLabel", { name, count: alerts.length })}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 296)) });
          setOpen((o) => !o);
        }}
        className={cn(
          "ml-1.5 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          severe ? "border-destructive bg-destructive/10 text-destructive" : "border-warning bg-warning/10 text-foreground",
        )}
      >
        <HeartPulse className="h-3 w-3" aria-hidden="true" />
        {severe ? t("severeShort") : alerts.length}
      </button>
      {open ? (
        <span id={id} role="dialog" aria-label={t("badgeLabel", { name, count: alerts.length })} style={{ top: pos.top, left: pos.left }} className="fixed z-50 w-72 max-w-[calc(100vw-16px)] rounded-md border bg-card p-3 text-left text-sm font-normal text-card-foreground shadow-lg">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("badgeTitle", { name })}</span>
          <ul className="space-y-1.5">
            {alerts.map((a, i) => (
              <li key={i}>
                <span className={cn("font-semibold", a.severity === "SEVERE" && "text-destructive")}>{t(`severity.${a.severity}`)}</span>
                {" · "}
                <span className="font-medium">{t(`category.${a.category}`)}</span>
                <span className="block">{a.text}</span>
              </li>
            ))}
          </ul>
          <span className="mt-2 block text-xs text-muted-foreground">{t("badgeFooter")}</span>
        </span>
      ) : null}
    </span>
  );
}
