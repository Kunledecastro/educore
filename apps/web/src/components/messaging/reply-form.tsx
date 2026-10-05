"use client";

import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { Textarea } from "@educore/ui/textarea";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { replyAction } from "@/app/(app)/messages/actions";
import { replySchema, type ReplyInput } from "@/lib/validation/messaging";

export function ReplyForm({ threadId, joining }: { threadId: string; joining: boolean }) {
  const t = useTranslations("messages");
  const { form, onSubmit, pending, fieldError } = useServerForm<ReplyInput>({
    schema: replySchema,
    defaultValues: { threadId, body: "" },
    submit: (v) => replyAction(v),
    successMessage: t("sent"),
    onSuccess: () => form.reset({ threadId, body: "" }),
  });
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <input type="hidden" {...form.register("threadId")} />
      <FormField label={t("reply")} htmlFor="reply-body" error={fieldError("body")} hint={joining ? t("joinHint") : undefined}>
        <Textarea id="reply-body" rows={4} maxLength={5000} {...form.register("body")} />
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t("sending") : joining ? t("joinAndSend") : t("send")}
        </Button>
      </div>
    </form>
  );
}
