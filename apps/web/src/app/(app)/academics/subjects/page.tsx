import { BookOpen } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@educore/db";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ListPagination } from "@/components/list/list-pagination";
import { ListSearch } from "@/components/list/list-search";
import { ListToolbar } from "@/components/list/list-toolbar";
import { SortableHeader } from "@/components/list/sortable-header";
import { requirePermission } from "@/lib/guard";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { NewSubjectButton, SubjectRowActions } from "./subject-ui";

const listConfig = { sortable: ["name", "code"] as const, defaultSort: "name" as const };

export default async function SubjectsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { db } = await requirePermission("subject", "read", { page: true });
  const t = await getTranslations("academics.subjects");
  const tl = await getTranslations("list");
  const params = parseListParams(searchParams, listConfig);

  const where: Prisma.SubjectWhereInput = params.q
    ? {
        OR: [
          { name: { contains: params.q, mode: "insensitive" } },
          { code: { contains: params.q, mode: "insensitive" } },
        ],
      }
    : {};

  const [total, subjects, anySubjects] = await Promise.all([
    db.subject.count({ where }),
    db.subject.findMany({
      where,
      orderBy: { [params.sort]: params.dir },
      skip: params.skip,
      take: params.take,
      include: { _count: { select: { classSectionSubjects: true } } },
    }),
    params.q ? db.subject.count() : Promise.resolve(-1),
  ]);

  if (total === 0 && (!params.q || anySubjects === 0)) {
    return (
      <EmptyState
        icon={<BookOpen className="h-6 w-6" />}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        action={<NewSubjectButton />}
      />
    );
  }

  return (
    <div>
      <ListToolbar actions={<NewSubjectButton />}>
        <ListSearch placeholder={t("searchPlaceholder")} />
      </ListToolbar>
      {subjects.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-6 w-6" />} title={tl("noResults")} description={tl("noResultsHint")} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader column="name" label={t("name")} defaultSort="name" />
                <SortableHeader column="code" label={t("code")} defaultSort="name" />
                <TableHead className="hidden sm:table-cell">{t("assignments")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("edit")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="font-mono text-xs">{s.code}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {t("assignmentsCount", { count: s._count.classSectionSubjects })}
                  </TableCell>
                  <TableCell>
                    <SubjectRowActions subject={{ id: s.id, name: s.name, code: s.code }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ListPagination page={params.page} pageSize={params.pageSize} total={total} />
    </div>
  );
}
