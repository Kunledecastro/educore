import { getTranslations } from "next-intl/server";
import { getEntitlements } from "@/lib/entitlements-server";
import { requirePermission } from "@/lib/guard";
import { leaveTypesForSettings } from "@/lib/leave/data";
import { LeaveTypeRow, NewLeaveType } from "./types-form";

export const dynamic = "force-dynamic";

/** Settings → Leave (Phase 8.2): the leave types the school offers and the days per school year. */
export default async function LeaveSettingsPage() {
  const ctx = await requirePermission("leaveSettings", "update", { page: true });
  const tenantId = ctx.user.tenantId!;
  const [ent, t] = await Promise.all([getEntitlements(tenantId), getTranslations("leave.settings")]);
  if (!ent.modules.has("approvals")) return <p className="rounded-lg border p-4 text-sm">{t("notInPlan")}</p>;
  const types = await leaveTypesForSettings(tenantId);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("explain")}</p>
      <section aria-labelledby="lt-list" className="space-y-3">
        <h2 id="lt-list" className="font-semibold">
          {t("typesTitle")}
        </h2>
        <ul className="divide-y rounded-lg border">
          {types.map((ty) => (
            <li key={ty.id} className="p-3">
              <LeaveTypeRow value={{ id: ty.id, name: ty.name, daysPerYear: ty.daysPerYear, isActive: ty.isActive }} />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="lt-new" className="space-y-3 rounded-lg border bg-card p-5">
        <h2 id="lt-new" className="font-semibold">
          {t("addTitle")}
        </h2>
        <NewLeaveType />
      </section>
    </div>
  );
}
