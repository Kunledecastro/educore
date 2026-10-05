"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Printer, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@educore/ui/badge";
import { Button } from "@educore/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@educore/ui/table";
import { ConfirmAction } from "@/components/form/confirm-action";
import { consentAction, issueLoginsAction, setLoginActiveAction } from "@/app/(app)/students/logins/actions";
import type { Slip } from "@/lib/student-logins-data";

const CHUNK = 20;
const STATE_VARIANT = { none: "secondary", firstSignIn: "warning", active: "success", disabled: "destructive" } as const;

export interface RosterRowView {
  studentId: string;
  name: string;
  admissionNo: string;
  section: string | null;
  state: "none" | "firstSignIn" | "active" | "disabled";
  consentAt: string | null;
}

/**
 * The class list with each student's login, and the actions: issue logins,
 * reset passwords, switch a login off/on, record consent. Issuing returns
 * one-time passwords, shown once on printable slips.
 */
export function LoginRoster({ rows, canCreate, schoolName, signInUrl }: { rows: RosterRowView[]; canCreate: boolean; schoolName: string; signInUrl: string }) {
  const t = useTranslations("studentLogins");
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [slips, setSlips] = React.useState<{ slips: Slip[]; school: string } | null>(null);

  const withoutLogin = rows.filter((r) => r.state === "none").map((r) => r.studentId);
  const allIds = rows.map((r) => r.studentId);
  const selectedWithLogin = [...selected].filter((id) => rows.find((r) => r.studentId === id)?.state !== "none" || canCreate);

  async function issue(ids: string[], label: string) {
    if (ids.length === 0) return;
    setBusy(label);
    const out: Slip[] = [];
    let school = "";
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const r = await issueLoginsAction(ids.slice(i, i + CHUNK));
        if (!r.ok) {
          toast.error(r.error);
          break;
        }
        out.push(...r.data.slips);
        school = r.data.school;
      }
    } finally {
      setBusy(null);
    }
    if (out.length) {
      setSlips({ slips: out, school });
      setSelected(new Set());
      router.refresh();
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canCreate ? (
          <Button type="button" disabled={busy !== null || withoutLogin.length === 0} onClick={() => issue(withoutLogin, "all")}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {busy === "all" ? t("issuing") : t("issueAll", { count: withoutLogin.length })}
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={busy !== null || selectedWithLogin.length === 0} onClick={() => issue(selectedWithLogin, "selected")}>
          {busy === "selected" ? t("issuing") : t("resetSelected", { count: selectedWithLogin.length })}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label={t("selectAll")}
                  className="h-4 w-4 accent-primary"
                  checked={selected.size > 0 && selected.size === allIds.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(allIds) : new Set())}
                />
              </TableHead>
              <TableHead>{t("student")}</TableHead>
              <TableHead>{t("admissionNo")}</TableHead>
              <TableHead>{t("section")}</TableHead>
              <TableHead>{t("login")}</TableHead>
              <TableHead>{t("consent")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.studentId}>
                <TableCell>
                  <input type="checkbox" aria-label={t("select", { name: r.name })} className="h-4 w-4 accent-primary" checked={selected.has(r.studentId)} onChange={() => toggle(r.studentId)} />
                </TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="font-mono text-sm">{r.admissionNo}</TableCell>
                <TableCell>{r.section ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={STATE_VARIANT[r.state]}>{t(`states.${r.state}`)}</Badge>
                </TableCell>
                <TableCell>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={Boolean(r.consentAt)}
                      onChange={async (e) => {
                        const res = await consentAction(r.studentId, e.target.checked);
                        if (res.ok) router.refresh();
                        else toast.error(res.error);
                      }}
                    />
                    <span className="sr-only">{t("consentFor", { name: r.name })}</span>
                    {r.consentAt ? <span className="text-xs text-muted-foreground">{r.consentAt}</span> : null}
                  </label>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {r.state === "none" ? (
                    canCreate ? (
                      <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => issue([r.studentId], r.studentId)}>
                        {t("issueOne")}
                      </Button>
                    ) : null
                  ) : (
                    <>
                      <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => issue([r.studentId], r.studentId)}>
                        {t("reset")}
                      </Button>
                      <ConfirmAction
                        trigger={
                          <Button type="button" variant="ghost" size="sm" className={r.state === "disabled" ? undefined : "text-destructive"}>
                            {r.state === "disabled" ? t("enable") : t("disable")}
                          </Button>
                        }
                        title={r.state === "disabled" ? t("enableTitle", { name: r.name }) : t("disableTitle", { name: r.name })}
                        description={r.state === "disabled" ? t("enableDescription") : t("disableDescription")}
                        confirmLabel={r.state === "disabled" ? t("enable") : t("disable")}
                        destructive={r.state !== "disabled"}
                        action={() => setLoginActiveAction(r.studentId, r.state === "disabled")}
                        successMessage={t("updated")}
                        onSuccess={() => router.refresh()}
                      />
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {slips ? <SlipSheet slips={slips.slips} school={slips.school} schoolName={schoolName} signInUrl={signInUrl} onClose={() => setSlips(null)} /> : null}
    </div>
  );
}

/** Printable login slips. The one-time passwords exist only here — once closed, they're gone. */
function SlipSheet({ slips, school, schoolName, signInUrl, onClose }: { slips: Slip[]; school: string; schoolName: string; signInUrl: string; onClose: () => void }) {
  const t = useTranslations("studentLogins.slips");
  React.useEffect(() => {
    document.body.classList.add("print-slips");
    return () => document.body.classList.remove("print-slips");
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="slips-title" className="fixed inset-0 z-50 overflow-auto bg-background p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <div>
            <h2 id="slips-title" className="text-lg font-semibold">{t("title", { count: slips.length })}</h2>
            <p className="text-sm text-destructive">{t("onceOnly")}</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              {t("print")}
            </Button>
            <ConfirmAction
              trigger={
                <Button type="button" variant="outline">
                  <X className="h-4 w-4" aria-hidden="true" />
                  {t("close")}
                </Button>
              }
              title={t("closeTitle")}
              description={t("closeDescription")}
              confirmLabel={t("close")}
              destructive={false}
              action={async () => ({ ok: true as const, data: undefined })}
              successMessage={t("closed")}
              onSuccess={onClose}
            />
          </div>
        </div>
        <div className="slips-print grid gap-3 sm:grid-cols-2">
          {slips.map((s) => (
            <section key={s.studentId} className="break-inside-avoid rounded-md border-2 border-dashed p-4 text-sm" aria-label={s.name}>
              <p className="font-semibold">{schoolName}</p>
              <p className="mt-1 text-base font-bold">{s.name}</p>
              <p className="text-muted-foreground">{s.className}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{t("website")}</dt>
                <dd className="break-all font-mono">{signInUrl}</dd>
                <dt className="text-muted-foreground">{t("schoolShort")}</dt>
                <dd className="font-mono">{school}</dd>
                <dt className="text-muted-foreground">{t("admissionNo")}</dt>
                <dd className="font-mono">{s.admissionNo}</dd>
                <dt className="text-muted-foreground">{t("password")}</dt>
                <dd className="font-mono text-base font-bold tracking-wider">{s.password}</dd>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">{t("instructions")}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
