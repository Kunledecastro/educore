import { getTranslations } from "next-intl/server";
import { cn } from "@educore/ui/utils";

const KNOWN = ["paid", "pending", "failed", "abandoned", "review", "unknown", "checking"] as const;
type Outcome = (typeof KNOWN)[number];

/** The message after returning from Paystack (?online=…). Purely informational: the database is the truth. */
export async function OnlineBanner({ outcome }: { outcome: string | undefined }) {
  if (!outcome || !(KNOWN as readonly string[]).includes(outcome)) return null;
  const t = await getTranslations("fees.online.outcome");
  const o = outcome as Outcome;
  const tone = o === "paid" ? "border-success/50 bg-success/10" : o === "failed" || o === "review" ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40";
  return (
    <div role="status" className={cn("rounded-md border p-3 text-sm", tone)}>
      {t(o)}
    </div>
  );
}
