import Link from "next/link";
import { Hourglass } from "lucide-react";
import { getTranslations } from "next-intl/server";

/** "Waiting for approval" notes on screens where a request is pending (Phase 8). */
export async function PendingApprovals({ items }: { items: { id: string; label: string }[] }) {
  if (items.length === 0) return null;
  const t = await getTranslations("approvals.pending");
  return (
    <div role="status" className="space-y-1 rounded-lg border border-warning bg-warning/10 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Hourglass className="h-4 w-4" aria-hidden="true" />
        {t("title", { count: items.length })}
      </p>
      <ul className="space-y-0.5 pl-6">
        {items.map((i) => (
          <li key={i.id}>
            {i.label} ·{" "}
            <Link href={`/approvals/${i.id}`} className="underline underline-offset-2">
              {t("view")}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
