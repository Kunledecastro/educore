"use client";

import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";

/** "Export ▾ CSV / Excel" — passes the page's current search and filters, so you export what you see. */
export function ExportMenu({ kind }: { kind: "students" | "staff" | "parents" | "invoices" | "payments" | "debtors" }) {
  const t = useTranslations("imports");
  const searchParams = useSearchParams();
  const href = (format: "csv" | "xlsx") => {
    const q = new URLSearchParams(searchParams.toString());
    q.delete("page");
    q.delete("size");
    q.set("format", format);
    return `/api/exports/${kind}?${q.toString()}`;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Download className="h-4 w-4" aria-hidden="true" />
          {t("exportTitle")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {(["csv", "xlsx"] as const).map((f) => (
          <DropdownMenuItem key={f} asChild>
            <a href={href(f)} download>
              {t(f)}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
