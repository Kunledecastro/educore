"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, buttonVariants } from "@educore/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { FormField } from "@/components/form/form-field";
import { uploadImport } from "./actions";

const SLUG = { STUDENTS: "students", STAFF: "staff", CLASSES: "classes" } as const;

export function UploadCard({
  kind,
  needsYear,
  years,
  defaultYearId,
}: {
  kind: "STUDENTS" | "STAFF" | "CLASSES";
  needsYear: boolean;
  years: { id: string; name: string; isActive: boolean }[];
  defaultYearId: string | null;
}) {
  const t = useTranslations("imports");
  const tc = useTranslations("academics.classes");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [fileError, setFileError] = React.useState<string | undefined>();
  const id = `upload-${kind.toLowerCase()}`;
  const blocked = needsYear && years.length === 0;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setFileError(t("errors.noFile"));
      return;
    }
    setFileError(undefined);
    startTransition(async () => {
      const result = await uploadImport(data);
      if (result.ok) router.push(`/imports/${result.data.id}`);
      else {
        setFileError(result.fieldErrors?.file);
        toast.error(result.error);
      }
    });
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">{t(`kinds.${kind}`)}</CardTitle>
        <p className="text-sm text-muted-foreground">{t(`kindDescriptions.${kind}`)}</p>
      </CardHeader>
      <CardContent className="mt-auto space-y-4">
        <a href={`/api/imports/template/${SLUG[kind]}`} className={buttonVariants({ variant: "link", size: "sm" }) + " h-auto px-0"} download>
          <Download className="h-4 w-4" aria-hidden="true" />
          {t("template")}
        </a>
        {blocked ? (
          <p className="text-sm text-muted-foreground">{t("noYear")}</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3" noValidate>
            <input type="hidden" name="kind" value={kind} />
            {needsYear ? (
              <FormField label={t("year")} htmlFor={`${id}-year`}>
                <Select name="academicYearId" defaultValue={defaultYearId ?? undefined}>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name} {y.isActive ? tc("activeSuffix") : ""}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            <FormField label={t("file")} htmlFor={`${id}-file`} hint={t("fileHint")} error={fileError}>
              <Input type="file" name="file" accept=".csv,text/csv" className="cursor-pointer" />
            </FormField>
            <Button type="submit" disabled={pending} className="w-full">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {pending ? t("uploading") : t("upload")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
