"use client";

import * as React from "react";
import { useForm, type DefaultValues, type FieldValues, type Path, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ZodTypeAny } from "zod";
import type { ActionResult } from "@/lib/action-result";

/**
 * React Hook Form + Zod on the client, the same schema re-checked by the
 * Server Action. Server-side field errors (e.g. a duplicate name) are put
 * back on the matching inputs; the form-level message becomes a toast.
 *
 * Schema messages are i18n keys (see lib/validation/common.ts); `fieldError`
 * translates them for display.
 */
export function useServerForm<TValues extends FieldValues>({
  schema,
  defaultValues,
  submit,
  successMessage,
  onSuccess,
}: {
  schema: ZodTypeAny;
  defaultValues: DefaultValues<TValues>;
  submit: (values: TValues) => Promise<ActionResult<unknown>>;
  successMessage: string;
  onSuccess?: () => void;
}) {
  const tRoot = useTranslations();
  const form = useForm<TValues>({
    // Validate the raw form values, but submit them untransformed: the server parses again.
    resolver: zodResolver(schema, undefined, { raw: true }) as unknown as Resolver<TValues>,
    defaultValues,
    mode: "onTouched",
  });
  const [pending, startTransition] = React.useTransition();

  const onSubmit = form.handleSubmit((values) =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await submit(values);
        if (result.ok) {
          toast.success(successMessage);
          onSuccess?.();
        } else {
          for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
            form.setError(field as Path<TValues>, { type: "server", message });
          }
          toast.error(result.error);
        }
        resolve();
      });
    }),
  );

  /** Translated error for a field, whether it came from the client schema (i18n key) or the server (text). */
  const fieldError = (name: Path<TValues>): string | undefined => {
    const message = form.getFieldState(name, form.formState).error?.message;
    if (!message) return undefined;
    return message.startsWith("validation.") ? tRoot(message as never) : message;
  };

  return { form, onSubmit, pending, fieldError };
}
