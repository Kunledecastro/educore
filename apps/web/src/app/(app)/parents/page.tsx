import Link from "next/link";
import { HeartHandshake } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Role, type Prisma } from "@educore/db";
import { buttonVariants } from "@educore/ui/button";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
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

const listConfig = { sortable: ["name", "email"] as const, defaultSort: "name" as const };

export default async function ParentsPage({ searchParams }: { searchParams: SearchParamsInput }) {
  const { db } = await requirePermission("guardian", "update", { page: true });
  const [t, tf, tl] = await Promise.all([getTranslations("parents"), getTranslations("people.fields"), getTranslations("list")]);
  const params = parseListParams(searchParams, listConfig);

  const base: Prisma.UserWhereInput = { role: Role.PARENT };
  const where: Prisma.UserWhereInput = {
    ...base,
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { email: { contains: params.q, mode: "insensitive" } },
            { guardianProfile: { is: { phone: { contains: params.q } } } },
          ],
        }
      : {}),
  };

  const [total, all, users] = await Promise.all([
    db.user.count({ where }),
    db.user.count({ where: base }),
    db.user.findMany({
      where,
      orderBy: [{ [params.sort]: params.dir }, { id: "asc" }],
      skip: params.skip,
      take: params.take,
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        passwordHash: true,
        guardianProfile: {
          select: {
            phone: true,
            occupation: true,
            students: { select: { student: { select: { id: true, firstName: true, lastName: true } } } },
          },
        },
      },
    }),
  ]);
  const statuses = await inviteStatusesFor(users);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} actions={all > 0 ? <ExportMenu kind="parents" /> : null} />
      {all === 0 ? (
        <EmptyState
          icon={<HeartHandshake className="h-6 w-6" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Link href="/students" className={buttonVariants()}>
              {t("goToStudents")}
            </Link>
          }
        />
      ) : (
        <>
          <ListToolbar>
            <ListSearch placeholder={t("searchPlaceholder")} />
          </ListToolbar>
          {users.length === 0 ? (
            <EmptyState icon={<HeartHandshake className="h-6 w-6" />} title={tl("noResults")} description={tl("noResultsHint")} />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader column="name" label={tf("name")} defaultSort="name" />
                    <TableHead className="hidden sm:table-cell">{tf("phone")}</TableHead>
                    <TableHead>{t("children")}</TableHead>
                    <TableHead className="hidden md:table-cell">{tf("status")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{tl("pagination")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const status = statuses.get(u.id) ?? "notInvited";
                    const children = u.guardianProfile?.students.map((s) => s.student) ?? [];
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{u.guardianProfile?.phone ?? "—"}</TableCell>
                        <TableCell>
                          {children.length === 0 ? (
                            <span className="text-muted-foreground">{t("noChildren")}</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {children.map((c) => (
                                <li key={c.id}>
                                  <Link href={`/students/${c.id}`} className="text-primary underline-offset-4 hover:underline">
                                    {c.firstName} {c.lastName}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <AccountStatusBadge status={status} />
                        </TableCell>
                        <TableCell>
                          <PersonActions
                            status={status}
                            person={{
                              kind: "parent",
                              data: {
                                userId: u.id,
                                name: u.name,
                                email: u.email,
                                phone: u.guardianProfile?.phone ?? "",
                                occupation: u.guardianProfile?.occupation ?? "",
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
