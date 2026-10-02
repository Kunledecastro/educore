"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";

export function PrintButton() {
  const t = useTranslations("timetable");
  return (
    <Button type="button" variant="outline" className="print:hidden" onClick={() => window.print()}>
      <Printer className="h-4 w-4" aria-hidden="true" />
      {t("print")}
    </Button>
  );
}
