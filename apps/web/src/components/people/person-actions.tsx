"use client";

import * as React from "react";
import { MoreHorizontal, Pencil, Send, UserCheck, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@educore/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@educore/ui/dropdown-menu";
import { ConfirmAction } from "@/components/form/confirm-action";
import { FormDialog } from "@/components/form/form-dialog";
import type { InviteStatus } from "@/lib/invite-token";
import { setUserActive } from "@/server/people-actions";
import { useSendInvite } from "./invite-link-dialog";
import { GuardianForm, StaffForm, TeacherForm, type GuardianFormData, type StaffFormData, type TeacherFormData } from "./person-forms";

type Person =
  | { kind: "teacher"; data: TeacherFormData }
  | { kind: "staff"; data: StaffFormData }
  | { kind: "parent"; data: GuardianFormData };

/** Row menu for any person with a login: edit, send/resend invite, deactivate/reactivate. */
export function PersonActions({ person, status, isSelf = false }: { person: Person; status: InviteStatus; isSelf?: boolean }) {
  const tc = useTranslations("common");
  const ti = useTranslations("people.invite");
  const ta = useTranslations("people.account");
  const tTitle = useTranslations(person.kind === "teacher" ? "teachers" : person.kind === "staff" ? "staff" : "parents");
  const [editing, setEditing] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const invite = useSendInvite();
  const { userId, name } = person.data;
  const isActive = status !== "deactivated";
  const canInvite = status === "notInvited" || status === "invited" || status === "expired";

  return (
    <div className="flex justify-end gap-1">
      {canInvite ? (
        <Button variant="outline" size="sm" disabled={invite.pending} onClick={() => invite.send(userId)} className="hidden sm:inline-flex">
          <Send className="h-4 w-4" aria-hidden="true" />
          {status === "notInvited" ? ti("send") : ti("resend")}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`${tc("more")}: ${name}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {tc("edit")}
          </DropdownMenuItem>
          {canInvite ? (
            <DropdownMenuItem onSelect={() => invite.send(userId)} className="sm:hidden">
              <Send className="h-4 w-4" aria-hidden="true" />
              {status === "notInvited" ? ti("send") : ti("resend")}
            </DropdownMenuItem>
          ) : null}
          {!isSelf ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive={isActive} onSelect={() => setToggling(true)}>
                {isActive ? <UserX className="h-4 w-4" aria-hidden="true" /> : <UserCheck className="h-4 w-4" aria-hidden="true" />}
                {isActive ? ta("deactivate") : ta("reactivate")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <FormDialog title={tTitle("edit")} open={editing} onOpenChange={setEditing}>
        {(close) =>
          person.kind === "teacher" ? (
            <TeacherForm teacher={person.data} onDone={close} />
          ) : person.kind === "staff" ? (
            <StaffForm staff={person.data} onDone={close} />
          ) : (
            <GuardianForm guardian={person.data} onDone={close} />
          )
        }
      </FormDialog>
      <ConfirmAction
        open={toggling}
        onOpenChange={setToggling}
        title={isActive ? ta("deactivateTitle", { name }) : ta("reactivateTitle", { name })}
        description={isActive ? ta("deactivateDescription", { name }) : ta("reactivateDescription", { name })}
        confirmLabel={isActive ? ta("deactivate") : ta("reactivate")}
        destructive={isActive}
        action={() => setUserActive(userId, !isActive)}
        successMessage={isActive ? ta("deactivated") : ta("reactivated")}
      />
      {invite.dialog}
    </div>
  );
}
