import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";
import type { AttendanceCounts } from "./attendance";
import type { DocBranding } from "./branding-data";
import type { HomeworkSummary } from "./pupil-profile";
import type { ProfileYear, PupilProfile, TermResult } from "./pupil-profile-data";
import { footerTop, PAGE_HEIGHT, pdfFontFamily } from "./report-card-pdf";

/**
 * Pupil profile report as a PDF (Phase 10.0): A4, on the school's
 * letterhead (logo, brand colour, contact line), labels in the school's
 * language. Years newest first. Prints correctly in black and white: severe
 * health alerts say "Severe" as well as being red.
 */

const INK = "#1f2937";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const SHADE = "#f3f4f6";
const RED = "#b91c1c";

const s = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 32, paddingBottom: 44, fontSize: 9, color: INK, lineHeight: 1.35 },
  header: { borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 8, marginBottom: 10 },
  brand: { flexDirection: "row", alignItems: "center" },
  logo: { width: 40, height: 40, objectFit: "contain", marginRight: 10 },
  school: { fontSize: 16, fontWeight: 700, lineHeight: 1.25 },
  contact: { fontSize: 8, color: MUTED, marginTop: 1 },
  title: { fontSize: 11, marginTop: 4, lineHeight: 1.25 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  field: { width: "50%", flexDirection: "row", marginBottom: 2 },
  label: { color: MUTED, width: 95 },
  value: { fontWeight: 700, flex: 1 },
  h2: { fontSize: 11, fontWeight: 700, marginTop: 8, marginBottom: 4 },
  yearHead: { fontSize: 11, fontWeight: 700, marginTop: 10, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: RULE },
  h3: { fontSize: 9.5, fontWeight: 700, marginTop: 4, marginBottom: 3 },
  table: { borderWidth: 1, borderColor: RULE, marginBottom: 6 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: RULE },
  lastRow: { flexDirection: "row" },
  headRow: { flexDirection: "row", backgroundColor: SHADE, borderBottomWidth: 1, borderBottomColor: RULE },
  totalRow: { flexDirection: "row", backgroundColor: SHADE },
  cell: { paddingVertical: 2.5, paddingHorizontal: 4 },
  num: { textAlign: "right" },
  bold: { fontWeight: 700 },
  muted: { color: MUTED },
  note: { color: MUTED, fontSize: 8, marginBottom: 6 },
  alertBox: { borderWidth: 1.25, borderColor: INK, padding: 6, marginBottom: 8 },
  alert: { flexDirection: "row", marginBottom: 1.5 },
  sev: { width: 60, fontWeight: 700 },
  severe: { color: RED },
  footer: { position: "absolute", top: footerTop(PAGE_HEIGHT.A4, 18, 7), left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", color: MUTED, fontSize: 7 },
});

type T = (key: string, values?: Record<string, string | number>) => string;

async function translatorFor(locale: string): Promise<T> {
  const lang = locale.toLowerCase().startsWith("fr") ? "fr" : "en";
  const messages = (await import(`../../messages/${lang}.json`)).default;
  return createTranslator({ locale: lang, messages, namespace: "pupilProfile.pdf" }) as unknown as T;
}

interface Fmt {
  n: (v: number | null) => string;
  pct: (v: number | null) => string;
  date: (d: Date | null) => string;
  dateTime: (d: Date) => string;
  money: (minor: number) => string;
}

function formatters(p: PupilProfile): Fmt {
  const { locale, timezone, dateStyle } = p.school.settings;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  // Date-only columns are stored as UTC midnight (see formatDateOnly).
  const df = new Intl.DateTimeFormat(locale, { dateStyle, timeZone: "UTC" });
  const dtf = new Intl.DateTimeFormat(locale, { dateStyle, timeStyle: "short", timeZone: timezone });
  const mf = new Intl.NumberFormat(locale, { style: "currency", currency: p.fees?.currency ?? p.school.settings.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return {
    n: (v) => (v === null ? "—" : nf.format(v)),
    pct: (v) => (v === null ? "—" : `${nf.format(v)}%`),
    date: (d) => (d ? df.format(d) : "—"),
    dateTime: (d) => dtf.format(d),
    money: (minor) => mf.format(minor / 100),
  };
}

/** A simple table: column widths in %, numeric columns right-aligned. */
function Table({ cols, rows, total }: { cols: { label: string; width: string; num?: boolean }[]; rows: string[][]; total?: string[] }) {
  return (
    <View style={s.table}>
      <View style={s.headRow} fixed>
        {cols.map((c, i) => (
          <Text key={i} style={[s.cell, s.bold, c.num ? s.num : {}, { width: c.width }]}>{c.label}</Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={ri === rows.length - 1 && !total ? s.lastRow : s.row} wrap={false}>
          {r.map((v, i) => (
            <Text key={i} style={[s.cell, cols[i]?.num ? s.num : {}, { width: cols[i]?.width }]}>{v}</Text>
          ))}
        </View>
      ))}
      {total ? (
        <View style={s.totalRow} wrap={false}>
          {total.map((v, i) => (
            <Text key={i} style={[s.cell, s.bold, cols[i]?.num ? s.num : {}, { width: cols[i]?.width }]}>{v}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AttendanceTable({ a, t, f }: { a: NonNullable<ProfileYear["attendance"]>; t: T; f: Fmt }) {
  const cols = [
    { label: t("term"), width: "30%" },
    { label: t("present"), width: "14%", num: true },
    { label: t("absent"), width: "14%", num: true },
    { label: t("late"), width: "14%", num: true },
    { label: t("excused"), width: "14%", num: true },
    { label: t("rate"), width: "14%", num: true },
  ];
  const line = (name: string, c: AttendanceCounts) => [name, String(c.present), String(c.absent), String(c.late), String(c.excused), f.pct(c.rate)];
  return <Table cols={cols} rows={a.terms.map((x) => line(x.name, x.counts))} total={line(t("wholeYear"), a.year)} />;
}

function ResultsBlock({ r, t, f, staff }: { r: TermResult; t: T; f: Fmt; staff: boolean }) {
  const cols = [
    { label: t("subject"), width: "40%" },
    { label: t("total"), width: "14%", num: true },
    { label: t("grade"), width: "12%" },
    { label: t("remark"), width: "34%" },
  ];
  const summary = [
    t("average", { value: f.n(r.average), count: r.subjectCount }),
    r.position !== null ? t("positionValue", { position: r.position, total: r.positionOutOf }) : null,
    staff && !r.published ? t("notPublished") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View>
      <View wrap={false}>
        <Text style={s.h3}>{t("resultsFor", { term: r.name })}</Text>
        <Text style={[s.muted, { marginBottom: 3 }]}>{summary}</Text>
      </View>
      <Table cols={cols} rows={r.subjects.map((x) => [x.name, `${f.n(x.total)}${x.total !== null && !x.complete ? "*" : ""}`, x.grade ?? "—", x.remark ?? ""])} />
      {r.incomplete > 0 ? <Text style={s.note}>{t("incompleteNote")}</Text> : null}
    </View>
  );
}

function HomeworkTable({ h, t, f }: { h: NonNullable<ProfileYear["homework"]>; t: T; f: Fmt }) {
  const cols = [
    { label: t("term"), width: "22%" },
    { label: t("set"), width: "10%", num: true },
    { label: t("handedIn"), width: "14%", num: true },
    { label: t("lateWork"), width: "10%", num: true },
    { label: t("missing"), width: "16%", num: true },
    { label: t("completion"), width: "13%", num: true },
    { label: t("averageMark"), width: "15%", num: true },
  ];
  const line = (name: string, x: HomeworkSummary) => [name, String(x.set), String(x.handedIn), String(x.late), String(x.missing), f.pct(x.rate), f.pct(x.averagePercent)];
  return <Table cols={cols} rows={h.terms.map((x) => line(x.name, x.summary))} total={line(t("wholeYear"), h.year)} />;
}

function Profile({ p, t, brand }: { p: PupilProfile; t: T; brand: DocBranding | null }) {
  const f = formatters(p);
  const fontFamily = pdfFontFamily();
  const has = (x: string) => p.sections.includes(x as PupilProfile["sections"][number]);
  const staff = !p.family;
  const pupil = p.pupil;
  const field = (label: string, value: string) => (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
  const knownGender = pupil.gender && ["FEMALE", "MALE", "OTHER"].includes(pupil.gender) ? t(`genders.${pupil.gender}`) : "—";
  const yearsWithContent = p.years.filter((y) => y.attendance || y.results?.length || y.homework);

  return (
    <Page size="A4" style={[s.page, { fontFamily }]} wrap>
      <View style={[s.header, brand?.color ? { borderBottomColor: brand.color } : {}]}>
        <View style={s.brand}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          {brand?.logo ? <Image src={brand.logo} style={s.logo} /> : null}
          <View>
            <Text style={s.school}>{p.school.name}</Text>
            {brand?.contactLine ? <Text style={s.contact}>{brand.contactLine}</Text> : null}
          </View>
        </View>
        <Text style={s.title}>{t("title", { name: pupil.name })}</Text>
      </View>

      <View style={s.grid}>
        {field(t("pupil"), pupil.name)}
        {field(t("admissionNo"), pupil.admissionNo)}
        {field(t("class"), pupil.className ?? "—")}
        {field(t("status"), t(`statuses.${pupil.status}`))}
        {field(t("dateOfBirth"), pupil.dateOfBirth ? `${f.date(pupil.dateOfBirth)} (${t("age", { age: pupil.age ?? 0 })})` : "—")}
        {field(t("gender"), knownGender)}
        {field(t("admissionDate"), f.date(pupil.admissionDate))}
        {field(t("formTeacher"), pupil.formTeacher ?? "—")}
        {pupil.leftAt ? field(t("leftOn"), f.date(pupil.leftAt)) : null}
      </View>

      {has("health") && p.health ? (
        <View style={s.alertBox} wrap={false}>
          <Text style={[s.bold, { marginBottom: 3 }]}>{t("healthAlerts")}</Text>
          {p.health.length === 0 ? (
            <Text style={s.muted}>{t("noAlerts")}</Text>
          ) : (
            p.health.map((a, i) => (
              <View key={i} style={s.alert}>
                <Text style={[s.sev, a.severity === "SEVERE" ? s.severe : {}]}>{t(`severity.${a.severity}`)}</Text>
                <Text style={{ flex: 1 }}>{`${t(`category.${a.category}`)}: ${a.text}`}</Text>
              </View>
            ))
          )}
          <Text style={[s.muted, { fontSize: 7.5, marginTop: 2 }]}>{t("alertsOnly")}</Text>
        </View>
      ) : null}

      {has("guardians") && p.guardians ? (
        <View wrap={false}>
          <Text style={s.h2}>{t("guardians")}</Text>
          {p.guardians.length === 0 ? (
            <Text style={[s.muted, { marginBottom: 6 }]}>{t("noGuardians")}</Text>
          ) : (
            <Table
              cols={[
                { label: t("name"), width: "30%" },
                { label: t("relationship"), width: "18%" },
                { label: t("phone"), width: "20%" },
                { label: t("email"), width: "32%" },
              ]}
              rows={p.guardians.map((g) => [`${g.name}${g.isPrimary ? ` (${t("primary")})` : ""}`, t(`relationships.${["MOTHER", "FATHER", "GUARDIAN"].includes(g.relationship) ? g.relationship : "OTHER"}`), g.phone ?? "—", g.email])}
            />
          )}
        </View>
      ) : null}

      {has("attendance") || has("results") || has("homework") ? (
        yearsWithContent.length === 0 ? (
          <Text style={[s.muted, { marginTop: 8 }]}>{t("noRecords")}</Text>
        ) : (
          yearsWithContent.map((y) => (
            <View key={y.id}>
              <Text style={s.yearHead} minPresenceAhead={60}>
                {[y.name, y.className, y.current ? t("currentYear") : null].filter(Boolean).join(" · ")}
              </Text>
              {y.attendance ? (
                <View wrap={false}>
                  <Text style={s.h3}>{t("attendance")}</Text>
                  <AttendanceTable a={y.attendance} t={t} f={f} />
                </View>
              ) : null}
              {(y.results ?? []).map((r) => (
                <ResultsBlock key={r.termId} r={r} t={t} f={f} staff={staff} />
              ))}
              {y.homework ? (
                <View wrap={false}>
                  <Text style={s.h3}>{t("homework")}</Text>
                  <HomeworkTable h={y.homework} t={t} f={f} />
                </View>
              ) : null}
            </View>
          ))
        )
      ) : null}
      {has("attendance") && yearsWithContent.some((y) => y.attendance) ? <Text style={s.note}>{t("rateExplained")}</Text> : null}

      {has("fees") && p.fees ? (
        // A short fee history stays on one page; a long one flows (the header row repeats).
        <View wrap={p.fees.rows.length > 12}>
          <Text style={s.h2} minPresenceAhead={60}>{t("fees")}</Text>
          {p.fees.rows.length === 0 ? (
            <Text style={s.muted}>{t("noInvoices")}</Text>
          ) : (
            <Table
              cols={[
                { label: t("invoice"), width: "36%" },
                { label: t("billed"), width: "16%", num: true },
                { label: t("discounts"), width: "16%", num: true },
                { label: t("paid"), width: "16%", num: true },
                { label: t("balance"), width: "16%", num: true },
              ]}
              rows={p.fees.rows.map((r) => [r.label, f.money(r.billedMinor), f.money(r.discountMinor), f.money(r.paidMinor), f.money(r.balanceMinor)])}
              total={[t("totalOwed"), f.money(p.fees.total.billedMinor), f.money(p.fees.total.discountMinor), f.money(p.fees.total.paidMinor), f.money(p.fees.total.balanceMinor)]}
            />
          )}
        </View>
      ) : null}

      <View style={s.footer} fixed>
        <Text>{t("generated", { name: p.generatedBy, date: f.dateTime(p.generatedAt) })}</Text>
        <Text>{t("confidential")}</Text>
        <Text render={({ pageNumber, totalPages }) => t("page", { page: pageNumber, total: totalPages })} />
      </View>
    </Page>
  );
}

export async function renderPupilProfile(p: PupilProfile, brand: DocBranding | null = null): Promise<Buffer> {
  const t = await translatorFor(p.school.settings.locale);
  return renderToBuffer(
    <Document title={t("title", { name: p.pupil.name })} author={p.school.name || "EduCore"} creator="EduCore" producer="EduCore">
      <Profile p={p} t={t} brand={brand} />
    </Document>,
  );
}
