import Link from "next/link";
import { CalendarOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Badge } from "@educore/ui/badge";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { STATUS_VARIANT } from "@/lib/approvals/describe";
import { formatDateOnly, formatNumber } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { myLeave } from "@/lib/leave/data";
import { getSettingsForUser } from "@/lib/tenant";
import { RequestLeaveForm, WithdrawLeaveButton } from "./leave-forms";

export const dynamic = "force-dynamic";

/** Staff leave (Phase 8.2): my balances, ask for leave, my requests and booked leave. */
export default async function LeavePage() {
  const { user } = await requirePermission("leave", "read", { page: true });
  const tenantId = user.tenantId!;
  const [data, settings, t, ta] = await Promise.all([myLeave(tenantId, user.id), getSettingsForUser(tenantId), getTranslations("leave"), getTranslations("approvals")]);
  const date = (d: string) => formatDateOnly(d, settings);
  const isAdmin = can(user.role, "leave", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={data.yearName ? t("description", { year: data.yearName }) : t("noYear")}
        actions={
          isAdmin ? (
            <>
              <Link href="/leave/calendar" className={buttonVariants({ variant: "outline" })}>
                {t("calendarLink")}
              </Link>
              <Link href="/settings/leave" className={buttonVariants({ variant: "ghost" })}>
                {t("typesLink")}
              </Link>
            </>
          ) : null
        }
      />

      {data.yearName ? (
        <>
          <section aria-labelledby="lv-balances" className="space-y-3">
            <h2 id="lv-balances" className="font-semibold">
              {t("balances")}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.types.map((ty) => (
                <li key={ty.id} className="rounded-lg border bg-card p-4">
                  <p className="text-sm font-medium">{ty.name}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{t("daysLeft", { count: ty.balance.left })}</p>
                  <p className="text-xs text-muted-foreground">{t("balanceDetail", { allowance: formatNumber(ty.balance.allowance, settings), taken: formatNumber(ty.balance.taken, settings), pending: formatNumber(ty.balance.pending, settings) })}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="lv-request" className="space-y-3 rounded-lg border bg-card p-5">
            <h2 id="lv-request" className="font-semibold">
              {t("requestTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("requestExplain")}</p>
            <RequestLeaveForm types={data.types.filter((x) => x.isActive).map((x) => ({ id: x.id, name: x.name, left: x.balance.left }))} />
          </section>
        </>
      ) : null}

      <section aria-labelledby="lv-requests" className="space-y-3">
        <h2 id="lv-requests" className="font-semibold">
          {t("myRequests")}
        </h2>
        {data.requests.length === 0 ? (
          <EmptyState icon={<CalendarOff className="h-6 w-6" />} title={t("noRequests")} description={t("noRequestsHint")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">{t("myRequests")}</caption>
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t("col.type")}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t("col.dates")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.days")}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">{t("col.status")}</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">{t("col.actions")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.requests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{r.leaveType}</td>
                    <td className="px-3 py-2">{t("range", { from: date(r.startDate), to: date(r.endDate) })}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.days}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_VARIANT[r.status]}>{ta(`status.${r.status}` as never)}</Badge>
                      {r.status === "FAILED" && r.failureCode ? <span className="mt-1 block text-xs text-muted-foreground">{t(`failure.${r.failureCode.replace("leave.", "")}` as never)}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">{r.status === "PENDING" ? <WithdrawLeaveButton requestId={r.id} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.booked.length ? (
        <section aria-labelledby="lv-booked" className="space-y-3">
          <h2 id="lv-booked" className="font-semibold">
            {t("booked")}
          </h2>
          <ul className="divide-y rounded-lg border text-sm">
            {data.booked.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{b.leaveType}</span> · {t("range", { from: date(b.startDate), to: date(b.endDate) })} · {t("days", { count: b.days })}
                </span>
                <Badge variant={b.status === "APPROVED" ? "success" : "secondary"}>{t(`bookedStatus.${b.status}` as never)}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
