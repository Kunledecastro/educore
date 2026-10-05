"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, ImageUp, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@educore/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@educore/ui/card";
import { Input } from "@educore/ui/input";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { BRAND_PRESETS, contrastRatio, foregroundFor, LOGO_MAX_BYTES, normaliseHex } from "@/lib/branding";
import { brandingSchema, type BrandingInput } from "@/lib/validation/branding";
import { removeLogoAction, saveBrandingAction, uploadLogoAction } from "../branding-actions";

const DEFAULT_PRIMARY = "#0f766e";

export function BrandingEditor({ schoolName, logoUrl, primaryColor, contactLine }: { schoolName: string; logoUrl: string | null; primaryColor: string; contactLine: string }) {
  const t = useTranslations("settings.branding");
  const router = useRouter();
  const { form, onSubmit, pending, fieldError } = useServerForm<BrandingInput>({
    schema: brandingSchema,
    defaultValues: { primaryColor, contactLine },
    submit: (v) => saveBrandingAction(v),
    successMessage: t("saved"),
    onSuccess: () => router.refresh(),
  });
  const raw = form.watch("primaryColor") ?? "";
  const hex = normaliseHex(raw) ?? (raw === "" ? DEFAULT_PRIMARY : null);
  const fg = hex ? foregroundFor(hex) : "#ffffff";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("logoTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <LogoUploader logoUrl={logoUrl} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("colorTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("presets")}>
                {BRAND_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => form.setValue("primaryColor", c, { shouldDirty: true, shouldValidate: true })}
                    className={`h-8 w-8 rounded-full border-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hex === c ? "border-foreground" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    aria-label={t("usePreset", { color: c })}
                    aria-pressed={hex === c}
                  />
                ))}
              </div>
              <div className="flex items-end gap-3">
                <FormField label={t("color")} htmlFor="brand-hex" error={fieldError("primaryColor")} hint={t("colorHint")}>
                  <Input id="brand-hex" placeholder={DEFAULT_PRIMARY} maxLength={7} className="w-32 font-mono" {...form.register("primaryColor")} />
                </FormField>
                <input
                  type="color"
                  aria-label={t("pickColor")}
                  value={hex ?? DEFAULT_PRIMARY}
                  onChange={(e) => form.setValue("primaryColor", e.target.value, { shouldDirty: true, shouldValidate: true })}
                  className="mb-1 h-10 w-14 cursor-pointer rounded border bg-background"
                />
                <Button type="button" variant="ghost" onClick={() => form.setValue("primaryColor", "", { shouldDirty: true })}>
                  {t("reset")}
                </Button>
              </div>
              {hex ? <p className="text-xs text-muted-foreground">{t("contrast", { ratio: contrastRatio(hex, fg).toFixed(1) })}</p> : null}
              <FormField label={t("contact")} htmlFor="brand-contact" error={fieldError("contactLine")} hint={t("contactHint")}>
                <Input id="brand-contact" maxLength={200} {...form.register("contactLine")} />
              </FormField>
              <Button type="submit" disabled={pending}>
                {pending ? t("saving") : t("save")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <aside aria-label={t("preview")} className="space-y-3">
        <p className="text-sm font-medium">{t("preview")}</p>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b p-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview of the school's own logo
              <img src={logoUrl} alt="" className="h-8 w-8 rounded object-contain" />
            ) : (
              <GraduationCap className="h-6 w-6" style={{ color: hex ?? DEFAULT_PRIMARY }} aria-hidden="true" />
            )}
            <span className="truncate text-sm font-semibold">{schoolName}</span>
          </div>
          <div className="space-y-3 p-3">
            <div className="rounded-md px-3 py-2 text-sm font-medium" style={{ backgroundColor: hex ?? DEFAULT_PRIMARY, color: fg }}>
              {t("previewMenu")}
            </div>
            <span className="inline-flex rounded-md px-4 py-2 text-sm font-medium" style={{ backgroundColor: hex ?? DEFAULT_PRIMARY, color: fg }}>
              {t("previewButton")}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("previewNote")}</p>
      </aside>
    </div>
  );
}

function LogoUploader({ logoUrl }: { logoUrl: string | null }) {
  const t = useTranslations("settings.branding");
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function upload(file: File) {
    setError(null);
    if (!["image/png", "image/jpeg"].includes(file.type)) return setError(t("errors.notImage"));
    if (file.size > LOGO_MAX_BYTES) return setError(t("errors.tooLarge", { max: Math.round(LOGO_MAX_BYTES / 1024) }));
    const fd = new FormData();
    fd.set("logo", file);
    startTransition(async () => {
      const r = await uploadLogoAction(fd);
      if (r.ok) {
        toast.success(t("logoSaved"));
        router.refresh();
      } else {
        setError(r.fieldErrors?.logo ?? r.error);
        toast.error(r.error);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-lg border bg-muted/30">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- the school's own logo
          <img src={logoUrl} alt={t("currentLogo")} className="h-16 w-16 object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">{t("noLogo")}</span>
        )}
      </div>
      <div className="space-y-2">
        <input
          ref={inputRef}
          id="brand-logo"
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
          aria-describedby="brand-logo-hint"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
            <ImageUp className="h-4 w-4" aria-hidden="true" />
            {pending ? t("uploading") : logoUrl ? t("replaceLogo") : t("uploadLogo")}
          </Button>
          {logoUrl ? (
            <ConfirmAction
              trigger={
                <Button type="button" variant="ghost" className="text-destructive">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t("removeLogo")}
                </Button>
              }
              title={t("removeTitle")}
              description={t("removeDescription")}
              confirmLabel={t("removeLogo")}
              action={() => removeLogoAction()}
              successMessage={t("logoRemoved")}
              onSuccess={() => router.refresh()}
            />
          ) : null}
        </div>
        <p id="brand-logo-hint" className="text-xs text-muted-foreground">
          {t("logoHint", { max: Math.round(LOGO_MAX_BYTES / 1024) })}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
