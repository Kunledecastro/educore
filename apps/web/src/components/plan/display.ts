import type { Module, PlanSpec, SubscriptionState } from "@/lib/entitlements";

export const STATE_VARIANT: Record<SubscriptionState, "success" | "secondary" | "warning" | "destructive"> = {
  trial: "secondary",
  active: "success",
  grace: "warning",
  readOnly: "destructive",
  suspended: "destructive",
};

/** The cheapest public plan that includes `module` — what to suggest on an "upgrade" prompt. */
export function cheapestPlanWith<T extends PlanSpec & { isPublic: boolean }>(plans: T[], module: Module): T | null {
  return plans.filter((p) => p.isPublic && p.modules.includes(module)).sort((a, b) => a.priceMinor - b.priceMinor)[0] ?? null;
}
