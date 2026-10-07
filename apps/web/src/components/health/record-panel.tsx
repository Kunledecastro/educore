"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Paperclip, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@educore/ui/badge";
import { Button } from "@educore/ui/button";
import { Input } from "@educore/ui/input";
import { Select } from "@educore/ui/select";
import { Textarea } from "@educore/ui/textarea";
import { ConfirmAction } from "@/components/form/confirm-action";
import { putToStorage, formatBytes } from "@/components/assignments/file-upload";
import {
  attachHealthDocumentAction,
  removeHealthDocumentAction,
  requestHealthDocumentUploadAction,
  saveContactsAction,
  saveProfileAction,
  verifyProfileAction,
  withdrawConsentAction,
} from "@/app/(app)/clinic/actions";
import { BLOOD_GROUPS, EMPTY_PROFILE, GENOTYPES, PERMITTABLE_MEDICINES, SEVERITIES, type HealthProfileData } from "@/lib/health/profile";
import { shrinkPhoto } from "@/lib/image-shrink";

export interface RecordPanelProps {
  studentId: string;
  mode: "nurse" | "parent" | "admin";
  profile: null | {
    data: HealthProfileData;
    status: "SUBMITTED" | "VERIFIED" | "CHANGED";
    consentText: string; // pre-formatted: "Given online by … on …"
    verifiedText: string | null;
  };
  contacts: { name: string; relationship: string; phone: string; altPhone: string }[];
  documents: { id: string; fileName: string; sizeBytes: number }[];
  canEdit: boolean;
  canVerify: boolean;
  storageReady: boolean;
}

const STATUS_VARIANT = { SUBMITTED: "warning", VERIFIED: "success", CHANGED: "warning" } as const;

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RecordPanel(props: RecordPanelProps) {
  const t = useTranslations("health");
  const router = useRouter();
  const [editing, setEditing] = React.useState(props.canEdit && !props.profile);
  return (
    <div className="space-y-6">
      <Section
        title={t("profile.title")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {props.profile ? <Badge variant={STATUS_VARIANT[props.profile.status]}>{t(`status.${props.profile.status}`)}</Badge> : <Badge variant="outline">{t("status.none")}</Badge>}
            {props.canVerify && props.profile && props.profile.status !== "VERIFIED" && !editing ? (
              <ConfirmAction
                trigger={
                  <Button size="sm">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    {t("verify")}
                  </Button>
                }
                title={t("verifyTitle")}
                description={t("verifyDescription")}
                confirmLabel={t("verify")}
                destructive={false}
                action={() => verifyProfileAction(props.studentId)}
                successMessage={t("verified")}
                onSuccess={() => router.refresh()}
              />
            ) : null}
            {props.canEdit && props.profile && !editing ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {t("edit")}
              </Button>
            ) : null}
          </div>
        }
      >
        {editing ? (
          <ProfileEditor
            studentId={props.studentId}
            mode={props.mode}
            initial={props.profile?.data ?? EMPTY_PROFILE}
            isNew={!props.profile}
            canVerify={props.canVerify}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={props.profile ? () => setEditing(false) : undefined}
          />
        ) : props.profile ? (
          <>
            <ProfileSummary data={props.profile.data} />
            <p className="text-xs text-muted-foreground">
              {props.profile.consentText}
              {props.profile.verifiedText ? ` · ${props.profile.verifiedText}` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{props.mode === "admin" ? t("noProfileAdmin") : t("noProfile")}</p>
        )}
      </Section>

      <ContactsSection studentId={props.studentId} contacts={props.contacts} canEdit={props.canEdit} />

      {props.profile ? <DocumentsSection studentId={props.studentId} documents={props.documents} canEdit={props.canEdit} storageReady={props.storageReady} /> : null}

      {props.canEdit && props.profile ? (
        <section className="space-y-2 rounded-lg border border-destructive/40 p-5">
          <h2 className="font-semibold">{t("withdraw.title")}</h2>
          <p className="text-sm text-muted-foreground">{props.mode === "parent" ? t("withdraw.explainParent") : t("withdraw.explainNurse")}</p>
          <ConfirmAction
            trigger={
              <Button variant="outline" size="sm" className="text-destructive">
                {t("withdraw.button")}
              </Button>
            }
            title={t("withdraw.confirmTitle")}
            description={t("withdraw.confirmDescription")}
            confirmLabel={t("withdraw.button")}
            action={() => withdrawConsentAction(props.studentId)}
            successMessage={t("withdraw.done")}
            onSuccess={() => router.refresh()}
          />
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only summary
// ---------------------------------------------------------------------------

function ProfileSummary({ data }: { data: HealthProfileData }) {
  const t = useTranslations("health.profile");
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
  const none = <span className="text-muted-foreground">{t("none")}</span>;
  return (
    <dl className="space-y-3">
      {row(t("bloodGroup"), data.bloodGroup === "unknown" ? t("unknown") : data.bloodGroup)}
      {row(t("genotype"), data.genotype === "unknown" ? t("unknown") : data.genotype)}
      {row(
        t("allergies"),
        data.allergies.length ? (
          <ul className="space-y-1">
            {data.allergies.map((a, i) => (
              <li key={i}>
                <span className="font-medium">{a.name}</span> <Badge variant={a.severity === "severe" ? "destructive" : a.severity === "moderate" ? "warning" : "secondary"}>{t(`severity.${a.severity}`)}</Badge>
                {a.reaction ? <span className="block text-muted-foreground">{a.reaction}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          none
        ),
      )}
      {row(
        t("conditions"),
        data.conditions.length ? (
          <ul className="space-y-1">
            {data.conditions.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.name}</span>
                {c.notes ? <span className="block whitespace-pre-line text-muted-foreground">{c.notes}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          none
        ),
      )}
      {row(
        t("medications"),
        data.medications.length ? (
          <ul className="space-y-1">
            {data.medications.map((m, i) => (
              <li key={i}>
                <span className="font-medium">{m.name}</span> {[m.dose, m.schedule].filter(Boolean).join(" · ")}
                {m.atSchool ? <Badge variant="outline" className="ml-2">{t("atSchool")}</Badge> : null}
              </li>
            ))}
          </ul>
        ) : (
          none
        ),
      )}
      {row(t("immunisations"), data.immunisations.length ? data.immunisations.map((m) => (m.date ? `${m.name} (${m.date})` : m.name)).join(", ") : none)}
      {row(t("doctor"), [data.doctor.name, data.doctor.hospital, data.doctor.phone].filter(Boolean).join(" · ") || none)}
      {row(t("hmo"), [data.hmo.provider, data.hmo.number].filter(Boolean).join(" · ") || none)}
      {row(t("permitted"), data.permittedMedicines.length ? data.permittedMedicines.map((m) => t(`medicines.${m}`)).join(", ") : t("permittedNone"))}
      {data.notes ? row(t("notes"), <span className="whitespace-pre-line">{data.notes}</span>) : null}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function ListEditor<T>({ label, items, onChange, blank, render, max, addLabel }: { label: string; items: T[]; onChange: (x: T[]) => void; blank: T; render: (item: T, set: (x: T) => void, i: number) => React.ReactNode; max: number; addLabel: string }) {
  const t = useTranslations("health.profile");
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md border p-2">
          <div className="grid flex-1 gap-2 sm:grid-cols-3">{render(item, (x) => onChange(items.map((y, j) => (j === i ? x : y))), i)}</div>
          <Button type="button" variant="ghost" size="sm" aria-label={t("remove")} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {items.length < max ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, blank])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {addLabel}
        </Button>
      ) : null}
    </fieldset>
  );
}

function ProfileEditor({ studentId, mode, initial, isNew, canVerify, onDone, onCancel }: { studentId: string; mode: RecordPanelProps["mode"]; initial: HealthProfileData; isNew: boolean; canVerify: boolean; onDone: () => void; onCancel?: () => void }) {
  const t = useTranslations("health.profile");
  const th = useTranslations("health");
  const [d, setD] = React.useState<HealthProfileData>(initial);
  const [consent, setConsent] = React.useState(false);
  const [verify, setVerify] = React.useState(canVerify);
  const [pending, start] = React.useTransition();
  const set = <K extends keyof HealthProfileData>(k: K, v: HealthProfileData[K]) => setD((x) => ({ ...x, [k]: v }));
  const needsConsent = mode === "parent" || isNew;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await saveProfileAction(studentId, { data: d, consent, verify: canVerify && verify });
      if (r.ok) {
        toast.success(r.data.status === "VERIFIED" ? th("savedVerified") : th("saved"));
        onDone();
      } else toast.error(r.error);
    });
  };

  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      <p className="text-sm text-muted-foreground">{t("guidance")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="h-blood" className="text-sm font-medium">
            {t("bloodGroup")}
          </label>
          <Select id="h-blood" value={d.bloodGroup} onChange={(e) => set("bloodGroup", e.target.value as HealthProfileData["bloodGroup"])}>
            {BLOOD_GROUPS.map((b) => (
              <option key={b} value={b}>
                {b === "unknown" ? t("unknown") : b}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="h-geno" className="text-sm font-medium">
            {t("genotype")}
          </label>
          <Select id="h-geno" value={d.genotype} onChange={(e) => set("genotype", e.target.value as HealthProfileData["genotype"])}>
            {GENOTYPES.map((g) => (
              <option key={g} value={g}>
                {g === "unknown" ? t("unknown") : g}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ListEditor
        label={t("allergies")}
        addLabel={t("addAllergy")}
        max={20}
        items={d.allergies}
        onChange={(x) => set("allergies", x)}
        blank={{ name: "", reaction: "", severity: "moderate" as (typeof SEVERITIES)[number] }}
        render={(a, put, i) => (
          <>
            <Input aria-label={t("allergyName", { n: i + 1 })} placeholder={t("allergyPlaceholder")} value={a.name} onChange={(e) => put({ ...a, name: e.target.value })} maxLength={120} />
            <Input aria-label={t("reaction")} placeholder={t("reaction")} value={a.reaction} onChange={(e) => put({ ...a, reaction: e.target.value })} maxLength={300} />
            <Select aria-label={t("severityLabel")} value={a.severity} onChange={(e) => put({ ...a, severity: e.target.value as (typeof SEVERITIES)[number] })}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`severity.${s}`)}
                </option>
              ))}
            </Select>
          </>
        )}
      />

      <ListEditor
        label={t("conditions")}
        addLabel={t("addCondition")}
        max={20}
        items={d.conditions}
        onChange={(x) => set("conditions", x)}
        blank={{ name: "", notes: "" }}
        render={(c, put, i) => (
          <>
            <Input aria-label={t("conditionName", { n: i + 1 })} placeholder={t("conditionPlaceholder")} value={c.name} onChange={(e) => put({ ...c, name: e.target.value })} maxLength={120} />
            <Textarea aria-label={t("conditionNotes")} placeholder={t("conditionNotes")} rows={2} className="sm:col-span-2" value={c.notes} onChange={(e) => put({ ...c, notes: e.target.value })} maxLength={1000} />
          </>
        )}
      />

      <ListEditor
        label={t("medications")}
        addLabel={t("addMedication")}
        max={20}
        items={d.medications}
        onChange={(x) => set("medications", x)}
        blank={{ name: "", dose: "", schedule: "", atSchool: false }}
        render={(m, put, i) => (
          <>
            <Input aria-label={t("medicationName", { n: i + 1 })} placeholder={t("medicationPlaceholder")} value={m.name} onChange={(e) => put({ ...m, name: e.target.value })} maxLength={120} />
            <Input aria-label={t("dose")} placeholder={t("dose")} value={m.dose} onChange={(e) => put({ ...m, dose: e.target.value })} maxLength={120} />
            <div className="space-y-1">
              <Input aria-label={t("schedule")} placeholder={t("schedule")} value={m.schedule} onChange={(e) => put({ ...m, schedule: e.target.value })} maxLength={200} />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={m.atSchool} onChange={(e) => put({ ...m, atSchool: e.target.checked })} />
                {t("atSchoolQuestion")}
              </label>
            </div>
          </>
        )}
      />

      <ListEditor
        label={t("immunisations")}
        addLabel={t("addImmunisation")}
        max={40}
        items={d.immunisations}
        onChange={(x) => set("immunisations", x)}
        blank={{ name: "", date: "" }}
        render={(m, put, i) => (
          <>
            <Input aria-label={t("immunisationName", { n: i + 1 })} placeholder={t("immunisationPlaceholder")} value={m.name} onChange={(e) => put({ ...m, name: e.target.value })} maxLength={120} />
            <Input aria-label={t("date")} type="date" value={m.date} onChange={(e) => put({ ...m, date: e.target.value })} />
          </>
        )}
      />

      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">{t("doctor")}</legend>
        <Input aria-label={t("doctorName")} placeholder={t("doctorName")} value={d.doctor.name} onChange={(e) => set("doctor", { ...d.doctor, name: e.target.value })} maxLength={120} />
        <Input aria-label={t("hospital")} placeholder={t("hospital")} value={d.doctor.hospital} onChange={(e) => set("doctor", { ...d.doctor, hospital: e.target.value })} maxLength={160} />
        <Input aria-label={t("phone")} placeholder={t("phone")} type="tel" value={d.doctor.phone} onChange={(e) => set("doctor", { ...d.doctor, phone: e.target.value })} maxLength={30} />
      </fieldset>

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">{t("hmo")}</legend>
        <Input aria-label={t("hmoProvider")} placeholder={t("hmoProvider")} value={d.hmo.provider} onChange={(e) => set("hmo", { ...d.hmo, provider: e.target.value })} maxLength={120} />
        <Input aria-label={t("hmoNumber")} placeholder={t("hmoNumber")} value={d.hmo.number} onChange={(e) => set("hmo", { ...d.hmo, number: e.target.value })} maxLength={60} />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("permitted")}</legend>
        <p className="text-xs text-muted-foreground">{t("permittedHint")}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {PERMITTABLE_MEDICINES.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={d.permittedMedicines.includes(m)}
                onChange={(e) => set("permittedMedicines", e.target.checked ? [...d.permittedMedicines, m] : d.permittedMedicines.filter((x) => x !== m))}
              />
              {t(`medicines.${m}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="h-notes" className="text-sm font-medium">
          {t("notes")}
        </label>
        <Textarea id="h-notes" rows={3} maxLength={2000} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>

      {needsConsent ? (
        <label className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{mode === "parent" ? th("consent.parent") : th("consent.paper")}</span>
        </label>
      ) : null}
      {canVerify ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
          {th("markVerified")}
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || (needsConsent && !consent)}>
          {pending ? th("saving") : th("save")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {th("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Emergency contacts
// ---------------------------------------------------------------------------

function ContactsSection({ studentId, contacts, canEdit }: { studentId: string; contacts: RecordPanelProps["contacts"]; canEdit: boolean }) {
  const t = useTranslations("health.contacts");
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [list, setList] = React.useState(contacts);
  const [pending, start] = React.useTransition();
  React.useEffect(() => setList(contacts), [contacts]);
  return (
    <Section
      title={t("title")}
      action={
        canEdit && !editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t("edit")}
          </Button>
        ) : null
      }
    >
      <p className="text-xs text-muted-foreground">{t("explain")}</p>
      {editing ? (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveContactsAction(studentId, list);
              if (r.ok) {
                toast.success(t("saved"));
                setEditing(false);
                router.refresh();
              } else toast.error(r.error);
            });
          }}
        >
          <ListEditor
            label={t("listLabel")}
            addLabel={t("add")}
            max={5}
            items={list}
            onChange={setList}
            blank={{ name: "", relationship: "", phone: "", altPhone: "" }}
            render={(c, put, i) => (
              <>
                <Input aria-label={t("name", { n: i + 1 })} placeholder={t("namePlaceholder")} value={c.name} onChange={(e) => put({ ...c, name: e.target.value })} maxLength={120} />
                <Input aria-label={t("relationship")} placeholder={t("relationship")} value={c.relationship} onChange={(e) => put({ ...c, relationship: e.target.value })} maxLength={60} />
                <div className="space-y-1">
                  <Input aria-label={t("phone")} placeholder={t("phone")} type="tel" value={c.phone} onChange={(e) => put({ ...c, phone: e.target.value })} maxLength={30} />
                  <Input aria-label={t("altPhone")} placeholder={t("altPhone")} type="tel" value={c.altPhone} onChange={(e) => put({ ...c, altPhone: e.target.value })} maxLength={30} />
                </div>
              </>
            )}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {t("save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setList(contacts); setEditing(false); }}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : contacts.length ? (
        <ol className="space-y-1 text-sm">
          {contacts.map((c, i) => (
            <li key={i}>
              <span className="font-medium">{c.name}</span>
              {c.relationship ? ` (${c.relationship})` : ""} — <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`} className="underline underline-offset-2">{c.phone}</a>
              {c.altPhone ? ` · ${c.altPhone}` : ""}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const DOC_TYPES: Record<string, "application/pdf" | "image/jpeg" | "image/png"> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

function DocumentsSection({ studentId, documents, canEdit, storageReady }: { studentId: string; documents: RecordPanelProps["documents"]; canEdit: boolean; storageReady: boolean }) {
  const t = useTranslations("health.documents");
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function upload(raw: File) {
    const file = await shrinkPhoto(raw);
    const type = (["application/pdf", "image/jpeg", "image/png"].includes(file.type) ? file.type : DOC_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""]) as "application/pdf" | "image/jpeg" | "image/png" | undefined;
    if (!type) return toast.error(t("badType"));
    setBusy(true);
    try {
      const slot = await requestHealthDocumentUploadAction(studentId, { fileName: file.name, contentType: type, sizeBytes: file.size });
      if (!slot.ok) return toast.error(slot.error);
      if (!(await putToStorage(slot.data.uploadUrl, file, type))) return toast.error(t("uploadFailed"));
      const done = await attachHealthDocumentAction(studentId, slot.data.grant);
      if (!done.ok) return toast.error(done.error);
      toast.success(t("added"));
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Section title={t("title")}>
      <p className="text-xs text-muted-foreground">{t("explain")}</p>
      {documents.length ? (
        <ul className="divide-y rounded-md border">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <a href={`/api/health/documents/${d.id}`} className="flex min-w-0 items-center gap-2 underline-offset-2 hover:underline" target="_blank" rel="noopener">
                <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{d.fileName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(d.sizeBytes)}</span>
              </a>
              {canEdit ? (
                <ConfirmAction
                  trigger={
                    <Button variant="ghost" size="sm" className="text-destructive" aria-label={t("removeNamed", { name: d.fileName })}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  }
                  title={t("removeTitle")}
                  description={t("removeDescription", { name: d.fileName })}
                  confirmLabel={t("remove")}
                  action={() => removeHealthDocumentAction(d.id)}
                  successMessage={t("removed")}
                  onSuccess={() => router.refresh()}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      )}
      {canEdit ? (
        storageReady ? (
          <div>
            <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" className="sr-only" id={`hd-${studentId}`} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              <Paperclip className="h-4 w-4" aria-hidden="true" />
              {busy ? t("uploading") : t("add")}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("storageOff")}</p>
        )
      ) : null}
    </Section>
  );
}
