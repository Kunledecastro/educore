import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { EmptyState } from "@educore/ui/empty-state";
import { ListPagination } from "@/components/list/list-pagination";
import { NewThreadButton } from "@/components/messaging/new-thread";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { listThreads, viewerFor } from "@/lib/messaging/data";
import type { MessagingRole } from "@/lib/messaging/rules";
import { getSettingsForUser } from "@/lib/tenant";

/** Messages (Phase 4.4): conversations between teachers and parents about a child. */
export default async function MessagesPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { user } = await requirePermission("message", "read", { page: true });
  const tenantId = user.tenantId!;
  const params = parseListParams(searchParams, { sortable: ["lastMessageAt"] as const, defaultSort: "lastMessageAt" as const, filters: { view: ["all"] }, defaultPageSize: 25 });
  const isAdmin = user.role === Role.SCHOOL_ADMIN;
  const all = isAdmin && params.filters.view === "all";
  const viewer = await viewerFor(tenantId, { id: user.id, role: user.role as MessagingRole });
  const [{ rows, total }, settings, t] = await Promise.all([listThreads(viewer, { all, skip: params.skip, take: params.take }), getSettingsForUser(tenantId), getTranslations("messages")]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("pageTitle")} description={t("pageDescription")} actions={<NewThreadButton searchable={user.role !== Role.PARENT} />} />
      {isAdmin ? (
        <nav aria-label={t("views")} className="flex gap-2 text-sm">
          <Link href="/messages" aria-current={!all ? "page" : undefined} className={`rounded-md px-3 py-1.5 ${!all ? "bg-primary text-primary-foreground" : "border"}`}>
            {t("mine")}
          </Link>
          <Link href="/messages?view=all" aria-current={all ? "page" : undefined} className={`rounded-md px-3 py-1.5 ${all ? "bg-primary text-primary-foreground" : "border"}`}>
            {t("allSchool")}
          </Link>
        </nav>
      ) : null}
      {all ? <p className="text-sm text-muted-foreground">{t("allSchoolNote")}</p> : null}
      {rows.length === 0 ? (
        <EmptyState icon={<MessageSquare className="h-6 w-6" />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((th) => (
            <li key={th.id}>
              <Link href={`/messages/${th.id}`} className="flex gap-3 px-4 py-3 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${th.unread ? "bg-primary" : "bg-transparent"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={`truncate ${th.unread ? "font-semibold" : "font-medium"}`}>
                      {th.subject}
                      {th.unread ? <span className="sr-only"> ({t("unread")})</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(th.lastMessageAt, settings)}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[th.student ? t("about", { name: th.student }) : null, th.others.join(", ")].filter(Boolean).join(" · ")}
                  </span>
                  {th.last ? <span className="mt-1 block truncate text-sm text-muted-foreground">{`${th.last.sender}: ${th.last.body}`}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total > params.pageSize ? <ListPagination page={params.page} pageSize={params.pageSize} total={total} /> : null}
    </div>
  );
}
