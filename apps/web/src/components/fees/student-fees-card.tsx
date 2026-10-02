import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import type { TenantScopedClient } from "@educore/db";
import { InvoiceStatusBadge } from "@/app/(app)/fees/status-badge";
import { toMinor } from "@/lib/fees";
import { formatDateOnly, formatMoney, todayInTimeZone } from "@/lib/format";
import { displayStatus, type StoredInvoiceStatus } from "@/lib/invoicing";
import type { TenantSettings } from "@/lib/tenant-settings";

/**
 * A student's invoices and balance, on their profile (finance staff and
 * admins). The caller has already applied the student row scope.
 */
export async function StudentFeesCard({ db, studentId, settings }: { db: TenantScopedClient; studentId: string; settings: TenantSettings }) {
  const t = await getTranslations("fees.studentCard");
  const today = todayInTimeZone(settings.timezone);
  const invoices = await db.invoice.findMany({
    where: { studentId },
    orderBy: [{ issueDate: "desc" }],
    take: 6,
    select: { id: true, invoiceNo: true, status: true, dueDate: true, totalDue: true, amountPaid: true, term: { select: { name: true } } },
  });
  const m = (v: { toString(): string }) => toMinor(v) ?? 0;
  const owed = invoices.filter((i) => i.status !== "CANCELLED").reduce((n, i) => n + m(i.totalDue) - m(i.amountPaid), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("balance", { amount: formatMoney(owed / 100, settings) })}</p>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/fees/invoices/${i.id}`} className="font-mono text-xs font-medium text-primary underline-offset-4 hover:underline">
                    {i.invoiceNo}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {i.term?.name ?? "—"} · {t("due", { date: formatDateOnly(i.dueDate, settings) })}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney(i.status === "CANCELLED" ? 0 : (m(i.totalDue) - m(i.amountPaid)) / 100, settings)}</span>
                  <InvoiceStatusBadge status={displayStatus({ status: i.status as StoredInvoiceStatus, dueDate: i.dueDate }, today)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
