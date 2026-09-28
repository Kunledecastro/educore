"use client";

import { useTranslations } from "next-intl";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { FormField } from "@/components/form/form-field";
import { FormDialogFooter } from "@/components/form/form-dialog";
import { useServerForm } from "@/components/form/use-server-form";
import {
  guardianSchema,
  STAFF_ROLES,
  staffSchema,
  teacherSchema,
  type GuardianInput,
  type StaffInput,
  type TeacherInput,
} from "@/lib/validation/people";
import { createStaff, createTeacher, updateGuardian, updateStaff, updateTeacher } from "@/server/people-actions";

export interface TeacherFormData {
  userId: string;
  name: string;
  email: string;
  employeeId: string;
  department: string;
  qualification: string;
  joiningDate: string;
}

export function TeacherForm({ teacher, onDone }: { teacher?: TeacherFormData; onDone: () => void }) {
  const t = useTranslations("teachers");
  const tf = useTranslations("people.fields");
  const { form, onSubmit, pending, fieldError } = useServerForm<TeacherInput>({
    schema: teacherSchema,
    defaultValues: {
      name: teacher?.name ?? "",
      email: teacher?.email ?? "",
      employeeId: teacher?.employeeId ?? "",
      department: teacher?.department ?? "",
      qualification: teacher?.qualification ?? "",
      joiningDate: teacher?.joiningDate ?? "",
    },
    submit: (v) => (teacher ? updateTeacher(teacher.userId, v) : createTeacher(v)),
    successMessage: teacher ? t("updated") : t("created"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={tf("name")} htmlFor="t-name" error={fieldError("name")} required>
        <Input autoComplete="off" autoFocus {...form.register("name")} />
      </FormField>
      <FormField label={tf("email")} htmlFor="t-email" hint={t("emailHint")} error={fieldError("email")} required>
        <Input type="email" autoComplete="off" {...form.register("email")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={tf("employeeId")} htmlFor="t-emp" error={fieldError("employeeId")} required>
          <Input className="uppercase" {...form.register("employeeId")} />
        </FormField>
        <FormField label={tf("joiningDate")} htmlFor="t-join" error={fieldError("joiningDate")}>
          <Input type="date" {...form.register("joiningDate")} />
        </FormField>
        <FormField label={tf("department")} htmlFor="t-dept" error={fieldError("department")}>
          <Input {...form.register("department")} />
        </FormField>
        <FormField label={tf("qualification")} htmlFor="t-qual" error={fieldError("qualification")}>
          <Input {...form.register("qualification")} />
        </FormField>
      </div>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}

export interface StaffFormData {
  userId: string;
  name: string;
  email: string;
  role: (typeof STAFF_ROLES)[number];
  employeeId: string;
  designation: string;
  department: string;
  joiningDate: string;
}

export function StaffForm({ staff, onDone }: { staff?: StaffFormData; onDone: () => void }) {
  const t = useTranslations("staff");
  const tf = useTranslations("people.fields");
  const tr = useTranslations("roles");
  const { form, onSubmit, pending, fieldError } = useServerForm<StaffInput>({
    schema: staffSchema,
    defaultValues: {
      name: staff?.name ?? "",
      email: staff?.email ?? "",
      role: staff?.role ?? "ACCOUNTANT",
      employeeId: staff?.employeeId ?? "",
      designation: staff?.designation ?? "",
      department: staff?.department ?? "",
      joiningDate: staff?.joiningDate ?? "",
    },
    submit: (v) => (staff ? updateStaff(staff.userId, v) : createStaff(v)),
    successMessage: staff ? t("updated") : t("created"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={tf("name")} htmlFor="s-name" error={fieldError("name")} required>
        <Input autoComplete="off" autoFocus {...form.register("name")} />
      </FormField>
      <FormField label={tf("email")} htmlFor="s-email" error={fieldError("email")} required>
        <Input type="email" autoComplete="off" {...form.register("email")} />
      </FormField>
      <FormField label={tf("role")} htmlFor="s-role" hint={t("roleHint")} error={fieldError("role")} required>
        <Select {...form.register("role")}>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {tr(r)}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={tf("employeeId")} htmlFor="s-emp" error={fieldError("employeeId")} required>
          <Input className="uppercase" {...form.register("employeeId")} />
        </FormField>
        <FormField label={tf("designation")} htmlFor="s-desig" error={fieldError("designation")}>
          <Input {...form.register("designation")} />
        </FormField>
        <FormField label={tf("department")} htmlFor="s-dept" error={fieldError("department")}>
          <Input {...form.register("department")} />
        </FormField>
        <FormField label={tf("joiningDate")} htmlFor="s-join" error={fieldError("joiningDate")}>
          <Input type="date" {...form.register("joiningDate")} />
        </FormField>
      </div>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}

export interface GuardianFormData {
  userId: string;
  name: string;
  email: string;
  phone: string;
  occupation: string;
}

export function GuardianForm({ guardian, onDone }: { guardian: GuardianFormData; onDone: () => void }) {
  const t = useTranslations("parents");
  const tf = useTranslations("people.fields");
  const { form, onSubmit, pending, fieldError } = useServerForm<GuardianInput>({
    schema: guardianSchema,
    defaultValues: { name: guardian.name, email: guardian.email, phone: guardian.phone, occupation: guardian.occupation },
    submit: (v) => updateGuardian(guardian.userId, v),
    successMessage: t("updated"),
    onSuccess: onDone,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField label={tf("name")} htmlFor="g-name" error={fieldError("name")} required>
        <Input autoComplete="off" autoFocus {...form.register("name")} />
      </FormField>
      <FormField label={tf("email")} htmlFor="g-email" error={fieldError("email")} required>
        <Input type="email" autoComplete="off" {...form.register("email")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={tf("phone")} htmlFor="g-phone" error={fieldError("phone")}>
          <Input type="tel" autoComplete="off" {...form.register("phone")} />
        </FormField>
        <FormField label={tf("occupation")} htmlFor="g-occ" error={fieldError("occupation")}>
          <Input {...form.register("occupation")} />
        </FormField>
      </div>
      <FormDialogFooter pending={pending} onCancel={onDone} />
    </form>
  );
}
