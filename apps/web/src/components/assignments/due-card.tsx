import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { listForFamily, type AssignmentViewer } from "@/lib/assignments/data";
import { familyState } from "@/lib/assignments/rules";
import { formatDateTime } from "@/lib/format";
import type { TenantSettings } from "@/lib/tenant-settings";

/** Students and parents: the next few pieces of work still to do (Phase 5.1). */
export async function AssignmentsDueCard({ viewer, settings }: { viewer: AssignmentViewer; settings: TenantSettings }) {
  const [families, t] = await Promise.all([listForFamily(viewer, { take: 50 }), getTranslations("assignments")]);
  const now = new Date();
  const due = families
    .flatMap((f) => f.assignments.filter((a) => a.mode === "ONLINE" && ["todo", "dueSoon", "overdue", "returned"].includes(familyState(a, a.submission, now))).map((a) => ({ ...a, child: f.student.name })))
    .sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime())
    .slice(0, 4);
  const showNames = viewer.role === "PARENT" && families.length > 1;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{t("dueCardTitle")}</CardTitle>
        <Link href="/assignments" className="text-sm underline underline-offset-2">
          {t("seeAll")}
        </Link>
      </CardHeader>
      <CardContent>
        {due.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("nothingDue")}</p>
        ) : (
          <ul className="space-y-3">
            {due.map((a) => (
              <li key={`${a.id}-${a.child}`}>
                <Link href={`/assignments/${a.id}`} className="font-medium underline-offset-2 hover:underline">
                  {a.title}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {showNames ? `${a.child} · ` : ""}
                  {a.subject} · {t("dueOn", { when: formatDateTime(a.dueAt, settings) })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
