import { Megaphone, Pin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { can } from "@educore/auth";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { ListPagination } from "@/components/list/list-pagination";
import { DeleteAnnouncementButton, EditAnnouncementButton, NewAnnouncementButton, type AnnouncementOptions } from "@/components/messaging/announcement-form";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { listAnnouncements, viewerFor } from "@/lib/messaging/data";
import type { MessagingRole } from "@/lib/messaging/rules";
import { getSettingsForUser } from "@/lib/tenant";

/** Announcements (Phase 4.4): everyone sees those meant for them, pinned first. */
export default async function AnnouncementsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { user, db } = await requirePermission("announcement", "read", { page: true });
  const tenantId = user.tenantId!;
  const params = parseListParams(searchParams, { sortable: ["publishedAt"] as const, defaultSort: "publishedAt" as const, defaultPageSize: 20 });
  const viewer = await viewerFor(tenantId, { id: user.id, role: user.role as MessagingRole });
  const [{ rows, total }, settings, t, tr] = await Promise.all([
    listAnnouncements(viewer, { skip: params.skip, take: params.take }),
    getSettingsForUser(tenantId),
    getTranslations("announcements"),
    getTranslations("roles"),
  ]);

  const isAdmin = user.role === Role.SCHOOL_ADMIN;
  const canPost = can(user.role, "announcement", "create");
  let options: AnnouncementOptions | null = null;
  if (canPost) {
    const classes = await db.classGrade.findMany({
      where: isAdmin ? { academicYear: { isActive: true } } : { id: { in: [...viewer.classIds] } },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });
    options = { isAdmin, classes };
  }
  const audience = (a: (typeof rows)[number]) =>
    a.audienceScope === "SCHOOL" ? t("audiences.SCHOOL") : a.audienceScope === "ROLE" ? t("toRole", { role: tr(a.audienceRole ?? "PARENT") }) : t("toClass", { name: a.audienceClass?.name ?? "—" });

  return (
    <div className="space-y-6">
      <PageHeader title={t("pageTitle")} description={t("pageDescription")} actions={options && (isAdmin || options.classes.length > 0) ? <NewAnnouncementButton options={options} /> : null} />
      {rows.length === 0 ? (
        <EmptyState icon={<Megaphone className="h-6 w-6" />} title={t("emptyTitle")} description={canPost ? t("emptyPoster") : t("emptyReader")} />
      ) : (
        <ul className="space-y-4">
          {rows.map((a) => (
            <li key={a.id}>
              <article className={`rounded-lg border bg-card p-5 ${a.isPinned ? "border-primary" : ""}`} aria-labelledby={`an-${a.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <h2 id={`an-${a.id}`} className="flex items-center gap-2 text-lg font-semibold">
                      {a.isPinned ? <Pin className="h-4 w-4 text-primary" aria-label={t("pinned")} /> : null}
                      {a.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t("byline", { name: a.publishedBy.name ?? "—", when: formatDateTime(a.publishedAt, settings) })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary">{audience(a)}</Badge>
                    {a.canEdit && options ? (
                      <EditAnnouncementButton
                        id={a.id}
                        options={options}
                        initial={{ title: a.title, body: a.body, audienceScope: a.audienceScope, audienceClassId: a.audienceClassId ?? "", audienceRole: (a.audienceRole ?? "") as never, isPinned: a.isPinned }}
                      />
                    ) : null}
                    {isAdmin ? <DeleteAnnouncementButton id={a.id} title={a.title} /> : null}
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm">{a.body}</p>
              </article>
            </li>
          ))}
        </ul>
      )}
      {total > params.pageSize ? <ListPagination page={params.page} pageSize={params.pageSize} total={total} /> : null}
    </div>
  );
}
