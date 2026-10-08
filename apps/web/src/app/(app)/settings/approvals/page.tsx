import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { approvalSettings, approverChoices } from "@/lib/approvals/engine";
import { APPROVAL_PROCESSES, HAS_AMOUNT, policyWarnings } from "@/lib/approvals/policy";
import { getEntitlements } from "@/lib/entitlements-server";
import { requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { PolicyForm } from "./policy-form";

export const dynamic = "force-dynamic";

/** Settings → Approvals (Phase 8.0): which actions need a second person, who approves, and from what amount. */
export default async function ApprovalSettingsPage() {
  const ctx = await requirePermission("approvalSettings", "update", { page: true });
  const tenantId = ctx.user.tenantId!;
  const [policies, people, settings, ent, t] = await Promise.all([approvalSettings(tenantId), approverChoices(tenantId), getSettingsForUser(tenantId), getEntitlements(tenantId), getTranslations("approvals.settings")]);
  if (!ent.modules.has("approvals")) {
    return <p className="rounded-lg border p-4 text-sm">{t("notInPlan")}</p>;
  }
  const active = people.filter((p) => p.isActive);
  const symbol = new Intl.NumberFormat(settings.locale, { style: "currency", currency: settings.currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? settings.currency;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("explain")}</p>
      {ctx.impersonation ? <p className="rounded-md border p-3 text-sm">{t("impersonating")}</p> : null}
      {APPROVAL_PROCESSES.map((p) => {
        const policy = policies[p];
        const warnings = policy.enabled ? policyWarnings(policy, active) : [];
        return (
          <section key={p} className="space-y-3 rounded-lg border bg-card p-5" aria-labelledby={`ap-${p}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`ap-${p}`} className="font-semibold">
                {t(`process.${p}.title`)}
              </h2>
              <Badge variant={policy.enabled ? "success" : "secondary"}>{policy.enabled ? t("on") : t("off")}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{t(`process.${p}.explain`)}</p>
            {warnings.map((w) => (
              <p key={w} role="status" className="rounded-md border border-warning bg-warning/10 p-3 text-sm">
                {t(`warning.${w}`)}
              </p>
            ))}
            <PolicyForm
              process={p}
              hasAmount={HAS_AMOUNT[p]}
              currencySymbol={symbol}
              people={active.map((x) => ({ id: x.id, name: x.name, role: x.role }))}
              initial={{
                enabled: policy.enabled,
                expiryDays: policy.expiryDays,
                step1: { roles: [...policy.step1.roles], userIds: [...policy.step1.userIds] },
                step2: policy.step2 ? { roles: [...policy.step2.roles], userIds: [...policy.step2.userIds] } : null,
                secondStepFrom: policy.secondStepFromMinor === null ? "" : String(policy.secondStepFromMinor / 100),
              }}
            />
          </section>
        );
      })}
    </div>
  );
}
