import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import type { TenantScopedClient } from "@educore/db";
import { toMinor } from "@/lib/fees";
import { formatDateTime, formatMoney, type FormatSettings } from "@/lib/format";
import { RecheckButton } from "./recheck-button";

const REASONS = new Set(["amountMismatch", "currencyMismatch", "referenceMismatch", "invoicePaid", "moreThanBalance", "invoiceCancelled", "futureDate", "notPositive"]);

/**
 * Online payments a person should look at (3.3): money Paystack took that
 * couldn't be applied (NEEDS_REVIEW), and checkouts still unconfirmed after
 * 30 minutes. "Check again" asks Paystack and settles if it can.
 */
export async function OnlineAttention({ db, settings, canRecheck }: { db: TenantScopedClient; settings: FormatSettings; canRecheck: boolean }) {
  const t = await getTranslations("payments.online");
  const since = new Date(Date.now() - 14 * 86_400_000);
  const stale = new Date(Date.now() - 30 * 60_000);
  const rows = await db.onlinePayment.findMany({
    where: { OR: [{ status: "NEEDS_REVIEW" }, { status: "PENDING", createdAt: { lt: stale, gte: since } }] },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { invoice: { select: { id: true, invoiceNo: true } }, student: { select: { firstName: true, lastName: true } }, payer: { select: { name: true } } },
  });
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="online-attention" className="space-y-2 rounded-lg border border-warning/50 p-4">
      <h2 id="online-attention" className="font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <span className="font-medium">
                {r.student.firstName} {r.student.lastName}
              </span>{" "}
              · <span className="tabular-nums">{formatMoney((toMinor(r.amount) ?? 0) / 100, settings)}</span> ·{" "}
              <Link href={`/fees/invoices/${r.invoice.id}`} className="font-mono text-xs text-primary underline-offset-4 hover:underline">
                {r.invoice.invoiceNo}
              </Link>
              <div className="text-xs text-muted-foreground">
                {formatDateTime(r.createdAt, settings)} · {r.payer?.name ?? "—"} · <span className="font-mono">{r.reference}</span>
              </div>
              {r.status === "NEEDS_REVIEW" ? <div className="text-xs text-destructive">{t(`reasons.${REASONS.has(r.message ?? "") ? r.message : "other"}` as never)}</div> : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={r.status === "NEEDS_REVIEW" ? "destructive" : "secondary"}>{t(`status.${r.status}` as never)}</Badge>
              {canRecheck && r.status === "PENDING" ? <RecheckButton id={r.id} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
