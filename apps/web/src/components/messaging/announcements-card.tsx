import Link from "next/link";
import { Pin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { formatDateTime } from "@/lib/format";
import { listAnnouncements, type FullViewer } from "@/lib/messaging/data";
import type { TenantSettings } from "@/lib/tenant-settings";

/** The latest announcements meant for this person, on their dashboard (Phase 4.4). */
export async function AnnouncementsCard({ viewer, settings }: { viewer: FullViewer; settings: TenantSettings }) {
  const [{ rows }, t] = await Promise.all([listAnnouncements(viewer, { take: 3 }), getTranslations("announcements")]);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{t("pageTitle")}</CardTitle>
        <Link href="/announcements" className="text-sm underline underline-offset-2">
          {t("seeAll")}
        </Link>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((a) => (
              <li key={a.id}>
                <p className="flex items-center gap-1 font-medium">
                  {a.isPinned ? <Pin className="h-3.5 w-3.5 text-primary" aria-label={t("pinned")} /> : null}
                  {a.title}
                </p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(a.publishedAt, settings)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
