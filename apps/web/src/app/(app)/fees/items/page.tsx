import { Coins } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { Badge } from "@educore/ui/badge";
import { EmptyState } from "@educore/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { requirePermission } from "@/lib/guard";
import { FeeItemRowActions, NewFeeItemButton } from "./item-actions";

/** Fee items: the things a school charges for (milestone 3.0). */
export default async function FeeItemsPage() {
  const { user, db } = await requirePermission("feeStructure", "read");
  const t = await getTranslations("fees.items");
  const items = await db.feeType.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: { _count: { select: { feeStructures: true, discounts: true } } },
  });
  const canEdit = can(user.role, "feeStructure", "update");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {canEdit && items.length > 0 ? <NewFeeItemButton /> : null}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<Coins className="h-6 w-6" />} title={t("emptyTitle")} description={t("emptyDescription")} action={canEdit ? <NewFeeItemButton /> : undefined} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("descriptionLabel")}</TableHead>
                <TableHead>{t("type")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, i) => (
                <TableRow key={item.id} className={item.isActive ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">
                    {item.name}
                    {item.description ? <div className="text-xs font-normal text-muted-foreground md:hidden">{item.description}</div> : null}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{item.description}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={item.isOptional ? "secondary" : "default"}>{item.isOptional ? t("optional") : t("compulsory")}</Badge>
                      {item.isOneOff ? <Badge variant="secondary">{t("oneOff")}</Badge> : null}
                      {!item.isActive ? <Badge variant="outline">{t("inactive")}</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {canEdit ? (
                      <FeeItemRowActions
                        item={{ id: item.id, name: item.name, description: item.description ?? "", isOptional: item.isOptional, isOneOff: item.isOneOff, isActive: item.isActive }}
                        isFirst={i === 0}
                        isLast={i === items.length - 1}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
