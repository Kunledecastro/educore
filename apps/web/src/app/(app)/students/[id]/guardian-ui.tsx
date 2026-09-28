"use client";

import * as React from "react";
import { Link2, MoreHorizontal, Star, Unlink, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { useServerForm } from "@/components/form/use-server-form";
import { useSendInvite } from "@/components/people/invite-link-dialog";
import type { InviteStatus } from "@/lib/invite-token";
import {
  existingGuardianLinkSchema,
  newGuardianLinkSchema,
  RELATIONSHIPS,
  type ExistingGuardianLinkInput,
  type NewGuardianLinkInput,
} from "@/lib/validation/people";
import { addNewGuardian, linkExistingGuardian, setPrimaryGuardian, unlinkGuardian } from "../actions";
import { StatusMenuItems as StatusItemsBase, useStatusChange as useStatusChangeLocal } from "../student-ui";

function RelationshipFields({
  register,
  fieldError,
  prefix,
}: {
  register: (name: "relationship" | "isPrimary") => Record<string, unknown>;
  fieldError: (name: "relationship") => string | undefined;
  prefix: string;
}) {
  const t = useTranslations("students");
  return (
    <>
      <FormField label={t("relationship")} htmlFor={`${prefix}-rel`} error={fieldError("relationship")} required>
        <Select {...register("relationship")}>
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {t(`relationships.${r}`)}
            </option>
          ))}
        </Select>
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 rounded border-input" {...register("isPrimary")} />
        {t("isPrimaryLabel")}
      </label>
    </>
  );
}

function NewGuardianForm({ studentId, firstGuardian, onDone }: { studentId: string; firstGuardian: boolean; onDone: () => void }) {
  const t = useTranslations("students");
  const tf = useTranslations("people.fields");
  const { form, onSubmit, pending, fieldError } = useServerForm<NewGuardianLinkInput>({
    schema: newGuardianLinkSchema,
    defaultValues: { studentId, name: "", email: "", phone: "", occupation: "", relationship: "MOTHER", isPrimary: firstGuardian },
    submit: addNewGuardian,
    successMessage: t("guardianAdded"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={tf("name")} htmlFor="ng-name" error={fieldError("name")} required>
        <Input autoComplete="off" autoFocus {...form.register("name")} />
      </FormField>
      <FormField label={tf("email")} htmlFor="ng-email" error={fieldError("email")} required>
        <Input type="email" autoComplete="off" {...form.register("email")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={tf("phone")} htmlFor="ng-phone" error={fieldError("phone")}>
          <Input type="tel" autoComplete="off" {...form.register("phone")} />
        </FormField>
        <FormField label={tf("occupation")} htmlFor="ng-occ" error={fieldError("occupation")}>
          <Input {...form.register("occupation")} />
        </FormField>
      </div>
      <RelationshipFields register={form.register} fieldError={fieldError} prefix="ng" />
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}

function LinkGuardianForm({ studentId, onDone }: { studentId: string; onDone: () => void }) {
  const t = useTranslations("students");
  const tf = useTranslations("people.fields");
  const { form, onSubmit, pending, fieldError } = useServerForm<ExistingGuardianLinkInput>({
    schema: existingGuardianLinkSchema,
    defaultValues: { studentId, email: "", relationship: "MOTHER", isPrimary: false },
    submit: linkExistingGuardian,
    successMessage: t("guardianLinked"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={tf("email")} htmlFor="lg-email" hint={t("linkGuardianHint")} error={fieldError("email")} required>
        <Input type="email" autoComplete="off" autoFocus {...form.register("email")} />
      </FormField>
      <RelationshipFields register={form.register} fieldError={fieldError} prefix="lg" />
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}

export function GuardianButtons({ studentId, hasGuardians }: { studentId: string; hasGuardians: boolean }) {
  const t = useTranslations("students");
  return (
    <div className="flex flex-wrap gap-2">
      <FormDialog
        title={t("addGuardian")}
        trigger={
          <Button variant="outline" size="sm">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t("addGuardian")}
          </Button>
        }
      >
        {(close) => <NewGuardianForm studentId={studentId} firstGuardian={!hasGuardians} onDone={close} />}
      </FormDialog>
      <FormDialog
        title={t("linkGuardian")}
        trigger={
          <Button variant="ghost" size="sm">
            <Link2 className="h-4 w-4" aria-hidden="true" />
            {t("linkGuardian")}
          </Button>
        }
      >
        {(close) => <LinkGuardianForm studentId={studentId} onDone={close} />}
      </FormDialog>
    </div>
  );
}

export function GuardianLinkActions({
  link,
  studentName,
}: {
  link: { id: string; userId: string; name: string; isPrimary: boolean; status: InviteStatus };
  studentName: string;
}) {
  const t = useTranslations("students");
  const ti = useTranslations("people.invite");
  const tc = useTranslations("common");
  const [unlinking, setUnlinking] = React.useState(false);
  const [primarying, setPrimarying] = React.useState(false);
  const invite = useSendInvite();
  const canInvite = link.status === "notInvited" || link.status === "invited" || link.status === "expired";
  return (
    <div className="flex shrink-0 items-center gap-1">
      {canInvite ? (
        <Button variant="outline" size="sm" disabled={invite.pending} onClick={() => invite.send(link.userId)}>
          {link.status === "notInvited" ? ti("send") : ti("resend")}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${tc("more")}: ${link.name}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {!link.isPrimary ? (
            <DropdownMenuItem onSelect={() => setPrimarying(true)}>
              <Star className="h-4 w-4" aria-hidden="true" />
              {t("makePrimary")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setUnlinking(true)}>
            <Unlink className="h-4 w-4" aria-hidden="true" />
            {t("unlink")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction
        open={primarying}
        onOpenChange={setPrimarying}
        title={t("makePrimary")}
        description={`${link.name} → ${studentName}`}
        confirmLabel={t("makePrimary")}
        destructive={false}
        action={() => setPrimaryGuardian(link.id)}
        successMessage={t("primaryUpdated")}
      />
      <ConfirmAction
        open={unlinking}
        onOpenChange={setUnlinking}
        title={t("unlinkTitle", { name: link.name })}
        description={t("unlinkDescription", { name: link.name, student: studentName })}
        confirmLabel={t("unlink")}
        action={() => unlinkGuardian(link.id)}
        successMessage={t("unlinked")}
      />
      {invite.dialog}
    </div>
  );
}

export function StudentStatusButton({ student }: { student: { id: string; name: string; status: string } }) {
  const t = useTranslations("students");
  const { pick, dialog } = useStatusChangeLocal(student);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">{t("changeStatus")}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <StatusItems current={student.status} onPick={pick} />
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  );
}

function StatusItems({ current, onPick }: { current: string; onPick: Parameters<typeof StatusItemsBase>[0]["onPick"] }) {
  return <StatusItemsBase student={{ status: current }} onPick={onPick} />;
}
