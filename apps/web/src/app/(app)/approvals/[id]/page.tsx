import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { PageHeader } from "@/components/page-header";
import { discountValueText, headline, STATUS_VARIANT } from "@/lib/approvals/describe";
import { getRequest } from "@/lib/approvals/engine";
import { formatDateTime, formatMoney } from "@/lib/format";
import { auditContextFor, requirePermission } from "@/lib/guard";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";
import { DecisionPanel, WithdrawButton } from "./decision";

export const dynamic = "force-dynamic";

/** One approval request: exactly what will change, who asked, each decision, and what this person can do. */
export default async function ApprovalRequestPage({ params }: { params: { id: string } }) {
  const ctx = await requirePermission("approval", "read", { page: true });
  const id = idSchema.safeParse(params.id);
  if (!id.success) notFound();
  const a = auditContextFor(ctx);
  const actor = { tenantId: a.tenantId, userId: ctx.user.id, role: ctx.user.role, impersonating: Boolean(ctx.impersonation) };
  const [r, settings, t, tf] = await Promise.all([getRequest(actor, id.data), getSettingsForUser(a.tenantId), getTranslations("approvals"), getTranslations("fees.rules")]);
  if (!r) notFound();
  const when = (d: Date) => formatDateTime(d, settings);
  const s = r.summary;
  const facts: [string, string][] = [];
  if (s.pupil) facts.push([t("detail.pupil"), `${s.pupil}${s.admissionNo ? ` (${s.admissionNo})` : ""}`]);
  if (s.invoiceNo) facts.push([t("detail.invoice"), s.invoiceNo]);
  if (s.receiptNo) facts.push([t("detail.receipt"), s.receiptNo]);
  if (s.discount) facts.push([t("detail.discount"), `${s.discount}${s.discountValue ? ` · ${discountValueText(s.discountValue, settings)}` : ""}`]);
  if (s.scope) facts.push([t("detail.scope"), s.scope]);
  if (r.amountMinor !== null) facts.push([r.process === "DISCOUNT_ASSIGN" ? t("detail.estimatedValue") : t("detail.amount"), formatMoney(r.amountMinor / 100, settings)]);
  if (s.reason) facts.push([t("detail.reason"), s.reason]);
  if (r.note && r.note !== s.reason) facts.push([t("detail.note"), r.note]);
  const failure = r.failureCode ? (r.failureCode.startsWith("fee.") ? tf(r.failureCode.slice(4) as never) : t(`failure.${r.failureCode.replace(".", "_")}` as never)) : null;

  return (
    <div className="space-y-6">
      <Link href="/approvals" className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <PageHeader
        title={headline(t as never, r.process, s)}
        description={`${t(`process.${r.process}`)} · ${t("requestedByOn", { name: r.requestedBy, date: when(r.createdAt) })}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[r.status]}>{t(`status.${r.status}`)}</Badge>
            {r.canWithdraw ? <WithdrawButton requestId={r.id} /> : null}
          </div>
        }
      />
      <section className="space-y-3 rounded-lg border bg-card p-5" aria-labelledby="what-changes">
        <h2 id="what-changes" className="font-semibold">
          {t("detail.whatChanges")}
        </h2>
        <p className="text-sm">{t(`detail.effect.${r.process}`)}</p>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {r.status === "PENDING" ? <p className="text-xs text-muted-foreground">{t("detail.expires", { date: when(r.expiresAt) })}</p> : null}
        {failure ? <p className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">{t("detail.failed", { reason: failure })}</p> : null}
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5" aria-labelledby="steps">
        <h2 id="steps" className="font-semibold">
          {t("detail.steps")}
        </h2>
        <ol className="space-y-2">
          {Array.from({ length: r.stepsRequired }, (_, i) => i + 1).map((n) => {
            const d = r.decisions.find((x) => x.step === n);
            return (
              <li key={n} className="flex items-start gap-3 text-sm">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${d?.decision === "APPROVE" ? "border-success bg-success/10" : d?.decision === "REJECT" ? "border-destructive bg-destructive/10" : ""}`} aria-hidden="true">
                  {d?.decision === "APPROVE" ? <Check className="h-3.5 w-3.5" /> : d?.decision === "REJECT" ? <X className="h-3.5 w-3.5" /> : n}
                </span>
                <div>
                  <p className="font-medium">{t("detail.stepN", { n })}</p>
                  {d ? (
                    <p>
                      {t(d.decision === "APPROVE" ? "detail.approvedBy" : "detail.rejectedBy", { name: d.by, date: when(d.at) })}
                      {d.comment ? <span className="block text-muted-foreground">“{d.comment}”</span> : null}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">{r.status === "PENDING" && r.currentStep === n ? t("detail.waiting") : t("detail.notReached")}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {r.canDecide ? <DecisionPanel requestId={r.id} step={r.currentStep} isFinal={r.currentStep === r.stepsRequired} /> : null}
    </div>
  );
}
