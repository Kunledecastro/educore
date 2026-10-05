import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ReplyForm } from "@/components/messaging/reply-form";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/guard";
import { openThread, viewerFor } from "@/lib/messaging/data";
import type { MessagingRole } from "@/lib/messaging/rules";
import { getSettingsForUser } from "@/lib/tenant";
import { idSchema } from "@/lib/validation/common";

/** One conversation. Opening it marks it read; school admins can read any (safeguarding). */
export default async function ThreadPage({ params }: { params: { id: string } }) {
  const { user } = await requirePermission("message", "read", { page: true });
  const id = idSchema.safeParse(params.id);
  if (!id.success) notFound();
  const tenantId = user.tenantId!;
  const viewer = await viewerFor(tenantId, { id: user.id, role: user.role as MessagingRole });
  const thread = await openThread(viewer, id.data);
  if (!thread) notFound();
  const [settings, t, tr] = await Promise.all([getSettingsForUser(tenantId), getTranslations("messages"), getTranslations("roles")]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/messages" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <PageHeader
        title={thread.subject}
        description={[thread.student ? t("about", { name: `${thread.student.firstName} ${thread.student.lastName}` }) : null, thread.participants.map((p) => `${p.user.name} (${tr(p.user.role)})`).join(", ")].filter(Boolean).join(" · ")}
      />
      {!thread.participating ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{t("viewingAsAdmin")}</p> : null}
      <ol className="space-y-3" aria-label={t("conversation")}>
        {thread.messages.map((m) => {
          const mine = m.senderId === user.id;
          return (
            <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${mine ? "bg-primary text-primary-foreground" : "border bg-card"}`}>
                <p className={`text-xs ${mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                  {`${mine ? t("you") : m.sender.name} · ${formatDateTime(m.sentAt, settings)}`}
                </p>
                <p className="mt-1 whitespace-pre-line">{m.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <ReplyForm threadId={thread.id} joining={!thread.participating} />
      <p className="text-xs text-muted-foreground">{t("safeguarding")}</p>
    </div>
  );
}
