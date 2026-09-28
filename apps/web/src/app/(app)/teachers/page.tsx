import { GraduationCap } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role, type Prisma } from "@educore/db";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ListFilter } from "@/components/list/list-filter";
import { ListPagination } from "@/components/list/list-pagination";
import { ListSearch } from "@/components/list/list-search";
import { ListToolbar } from "@/components/list/list-toolbar";
import { SortableHeader } from "@/components/list/sortable-header";
import { PageHeader } from "@/components/page-header";
import { ExportMenu } from "@/components/list/export-menu";
import { AccountStatusBadge } from "@/components/people/account-status-badge";
import { PersonActions } from "@/components/people/person-actions";
import { requirePermission } from "@/lib/guard";
import { inviteStatusesFor } from "@/lib/invite-status";
import { parseListParams, type SearchParamsInput } from "@/lib/list-params";
import { toDateInput } from "@/lib/validation/common";
import { NewPersonButton } from "./new-teacher-button";

const listConfig = {
  sortable: ["name", "employeeId"] as const,
  defaultSort: "name" as const,
  filters: { active: ["yes", "no"] },
};

export default async function TeachersPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { db } = await requirePermission("teacher", "read");
  const [t, tf, tl, ta] = await Promise.all([
    getTranslations("teachers"),
    getTranslations("people.fields"),
    getTranslations("list"),
    getTranslations("people.status"),
  ]);
  const params = parseListParams(searchParams, listConfig);

  const where: Prisma.TeacherWhereInput = {
    user: { role: Role.TEACHER, ...(params.filters.active ? { isActive: params.filters.active === "yes" } : {}) },
    ...(params.q
      ? {
          OR: [
            { user: { name: { contains: params.q, mode: "insensitive" } } },
            { user: { email: { contains: params.q, mode: "insensitive" } } },
            { employeeId: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, all, teachers] = await Promise.all([
    db.teacher.count({ where }),
    db.teacher.count(),
    db.teacher.findMany({
      where,
      orderBy: params.sort === "employeeId" ? { employeeId: params.dir } : { user: { name: params.dir } },
      skip: params.skip,
      take: params.take,
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true, passwordHash: true } },
        _count: { select: { classSectionSubjects: true } },
      },
    }),
  ]);
  const statuses = await inviteStatusesFor(teachers.map((x) => x.user));

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} actions={all > 0 ? (<><ExportMenu kind="staff" /><NewPersonButton kind="teacher" /></>) : null} />
      {all === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<NewPersonButton kind="teacher" />}
        />
      ) : (
        <>
          <ListToolbar>
            <ListSearch placeholder={t("searchPlaceholder")} />
            <ListFilter
              name="active"
              label={tf("status")}
              options={[
                { value: "yes", label: ta("active") },
                { value: "no", label: ta("deactivated") },
              ]}
            />
          </ListToolbar>
          {teachers.length === 0 ? (
            <EmptyState icon={<GraduationCap className="h-6 w-6" />} title={tl("noResults")} description={tl("noResultsHint")} />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader column="name" label={tf("name")} defaultSort="name" />
                    <SortableHeader column="employeeId" label={tf("employeeId")} defaultSort="name" className="hidden sm:table-cell" />
                    <TableHead className="hidden lg:table-cell">{tf("department")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("teaches")}</TableHead>
                    <TableHead>{tf("status")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{tl("pagination")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teachers.map((x) => {
                    const status = statuses.get(x.user.id) ?? "notInvited";
                    return (
                      <TableRow key={x.id}>
                        <TableCell>
                          <div className="font-medium">{x.user.name}</div>
                          <div className="text-xs text-muted-foreground">{x.user.email}</div>
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs sm:table-cell">{x.employeeId}</TableCell>
                        <TableCell className="hidden lg:table-cell">{x.department ?? "—"}</TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {t("teachesCount", { count: x._count.classSectionSubjects })}
                        </TableCell>
                        <TableCell>
                          <AccountStatusBadge status={status} />
                        </TableCell>
                        <TableCell>
                          <PersonActions
                            status={status}
                            person={{
                              kind: "teacher",
                              data: {
                                userId: x.user.id,
                                name: x.user.name,
                                email: x.user.email,
                                employeeId: x.employeeId,
                                department: x.department ?? "",
                                qualification: x.qualification ?? "",
                                joiningDate: toDateInput(x.joiningDate),
                              },
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <ListPagination page={params.page} pageSize={params.pageSize} total={total} />
        </>
      )}
    </div>
  );
}
