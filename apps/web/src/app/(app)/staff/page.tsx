import { Briefcase } from "lucide-react";
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
import { STAFF_ROLES } from "@/lib/validation/people";
import { NewPersonButton } from "../teachers/new-teacher-button";

const listConfig = {
  sortable: ["name", "role"] as const,
  defaultSort: "name" as const,
  filters: { role: STAFF_ROLES, active: ["yes", "no"] },
};

/**
 * Staff = users with an admin or accountant login. ASSUMPTION: school admins
 * created before this page existed (e.g. the seeded one) have no Staff
 * profile row; they're still listed, and editing them creates the profile.
 */
export default async function StaffPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { db, user: me } = await requirePermission("staff", "read", { page: true });
  const [t, tf, tl, ta, tr] = await Promise.all([
    getTranslations("staff"),
    getTranslations("people.fields"),
    getTranslations("list"),
    getTranslations("people.status"),
    getTranslations("roles"),
  ]);
  const params = parseListParams(searchParams, listConfig);

  const base: Prisma.UserWhereInput = { role: { in: [...STAFF_ROLES] } };
  const where: Prisma.UserWhereInput = {
    ...base,
    ...(params.filters.role ? { role: params.filters.role as (typeof STAFF_ROLES)[number] } : {}),
    ...(params.filters.active ? { isActive: params.filters.active === "yes" } : {}),
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { email: { contains: params.q, mode: "insensitive" } },
            { staffProfile: { is: { employeeId: { contains: params.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [total, all, users] = await Promise.all([
    db.user.count({ where }),
    db.user.count({ where: base }),
    db.user.findMany({
      where,
      orderBy: [{ [params.sort]: params.dir }, { name: "asc" }],
      skip: params.skip,
      take: params.take,
      select: { id: true, name: true, email: true, role: true, isActive: true, passwordHash: true, staffProfile: true },
    }),
  ]);
  const statuses = await inviteStatusesFor(users);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} actions={<><ExportMenu kind="staff" /><NewPersonButton kind="staff" /></>} />
      {all === 0 ? (
        <EmptyState icon={<Briefcase className="h-6 w-6" />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <>
          <ListToolbar>
            <ListSearch placeholder={t("searchPlaceholder")} />
            <ListFilter name="role" label={tf("role")} options={STAFF_ROLES.map((r) => ({ value: r, label: tr(r) }))} />
            <ListFilter
              name="active"
              label={tf("status")}
              options={[
                { value: "yes", label: ta("active") },
                { value: "no", label: ta("deactivated") },
              ]}
            />
          </ListToolbar>
          {users.length === 0 ? (
            <EmptyState icon={<Briefcase className="h-6 w-6" />} title={tl("noResults")} description={tl("noResultsHint")} />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader column="name" label={tf("name")} defaultSort="name" />
                    <SortableHeader column="role" label={tf("role")} defaultSort="name" />
                    <TableHead className="hidden md:table-cell">{tf("designation")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{tf("employeeId")}</TableHead>
                    <TableHead>{tf("status")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{tl("pagination")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const status = statuses.get(u.id) ?? "notInvited";
                    const role = u.role as (typeof STAFF_ROLES)[number];
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell>{tr(role)}</TableCell>
                        <TableCell className="hidden md:table-cell">{u.staffProfile?.designation ?? "—"}</TableCell>
                        <TableCell className="hidden font-mono text-xs sm:table-cell">{u.staffProfile?.employeeId ?? "—"}</TableCell>
                        <TableCell>
                          <AccountStatusBadge status={status} />
                        </TableCell>
                        <TableCell>
                          <PersonActions
                            status={status}
                            isSelf={u.id === me.id}
                            person={{
                              kind: "staff",
                              data: {
                                userId: u.id,
                                name: u.name,
                                email: u.email,
                                role,
                                employeeId: u.staffProfile?.employeeId ?? "",
                                designation: u.staffProfile?.designation ?? "",
                                department: u.staffProfile?.department ?? "",
                                joiningDate: toDateInput(u.staffProfile?.joiningDate),
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
