import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import type { listForFamily } from "@/lib/assignments/data";
import { familyState } from "@/lib/assignments/rules";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { TenantSettings } from "@/lib/tenant-settings";

type Children = Awaited<ReturnType<typeof listForFamily>>;

const STATE_VARIANT = { todo: "secondary", dueSoon: "warning", overdue: "destructive", handedIn: "secondary", returned: "warning", marked: "success", closed: "outline", paper: "outline" } as const;
type ShownState = keyof typeof STATE_VARIANT;
const OPEN: ReadonlySet<ShownState> = new Set(["todo", "dueSoon", "overdue", "returned", "paper"]);

/** Students' and parents' view: what's due first, then everything else (Phase 5.1). */
export async function FamilyAssignmentList({ families, settings, showNames, limit }: { families: Children; settings: TenantSettings; showNames: boolean; limit?: number }) {
  const t = await getTranslations("assignments");
  const now = new Date();
  if (families.length === 0 || families.every((c) => c.assignments.length === 0)) {
    return <EmptyState icon={<NotebookPen className="h-6 w-6" />} title={t("emptyTitle")} description={t("emptyFamily")} />;
  }
  return (
    <div className="space-y-8">
      {families.map(({ student, assignments }) => {
        const rows = assignments
          .map((a) => {
            const state: ShownState = familyState(a, a.submission, now);
            // Paper work is handed in at school; the teacher records it.
            return { ...a, state: a.mode === "PAPER" && !a.submission && state !== "closed" ? ("paper" as const) : state };
          })
          .sort((x, y) => {
            const open = (s: ShownState) => (OPEN.has(s) ? 0 : 1);
            return open(x.state) - open(y.state) || (open(x.state) === 0 ? x.dueAt.getTime() - y.dueAt.getTime() : y.dueAt.getTime() - x.dueAt.getTime());
          })
          .slice(0, limit ?? Infinity);
        return (
          <section key={student.id} aria-labelledby={`fam-${student.id}`} className="space-y-3">
            {showNames ? (
              <h2 id={`fam-${student.id}`} className="text-lg font-semibold">
                {student.name}
              </h2>
            ) : (
              <h2 id={`fam-${student.id}`} className="sr-only">
                {student.name}
              </h2>
            )}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("nothingSet")}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {rows.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <Link href={`/assignments/${a.id}${showNames ? `?student=${student.id}` : ""}`} className="font-medium underline-offset-2 hover:underline">
                        {a.title}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {a.subject} · {t("dueOn", { when: formatDateTime(a.dueAt, settings) })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.submission?.score !== null && a.submission?.score !== undefined && a.maxScore ? (
                        <span className="text-sm tabular-nums">{t("scoreOf", { score: formatNumber(a.submission.score, settings), max: formatNumber(a.maxScore, settings) })}</span>
                      ) : null}
                      <Badge variant={STATE_VARIANT[a.state]}>{t(`familyStates.${a.state}`)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
