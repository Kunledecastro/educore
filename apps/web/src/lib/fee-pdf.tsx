import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { DocBranding } from "./branding-data";
import { createTranslator } from "next-intl";
import { pdfFontFamily } from "./report-card-pdf";

/**
 * Invoice and receipt PDFs (milestones 3.1 / 3.2). A4, labels in the
 * SCHOOL's language, money and dates formatted with the school's settings.
 * Callers pass plain, already-authorised data — nothing is queried here.
 */

const INK = "#1f2937";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const SHADE = "#f3f4f6";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: INK, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 10, marginBottom: 14 },
  school: { fontSize: 16, fontWeight: 700, lineHeight: 1.25 },
  brand: { flexDirection: "row", alignItems: "center", maxWidth: "60%" },
  logo: { width: 44, height: 44, objectFit: "contain", marginRight: 10 },
  contact: { fontSize: 8, color: MUTED, marginTop: 2 },
  docTitle: { fontSize: 14, fontWeight: 700, textAlign: "right", lineHeight: 1.25 },
  docNo: { fontSize: 10, textAlign: "right", color: MUTED },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 14 },
  field: { width: "50%", flexDirection: "row", marginBottom: 3 },
  label: { color: MUTED, width: 95 },
  value: { fontWeight: 700, flex: 1 },
  table: { borderWidth: 1, borderColor: RULE, marginBottom: 12 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: RULE },
  headRow: { flexDirection: "row", backgroundColor: SHADE, borderBottomWidth: 1, borderBottomColor: RULE },
  totalRow: { flexDirection: "row", backgroundColor: SHADE },
  cell: { paddingVertical: 4, paddingHorizontal: 6 },
  desc: { flex: 1 },
  amt: { width: 120, textAlign: "right" },
  bold: { fontWeight: 700 },
  muted: { color: MUTED },
  big: { fontSize: 18, fontWeight: 700, lineHeight: 1.25 },
  stamp: { marginTop: 8, borderWidth: 2, padding: 8, alignSelf: "flex-start", fontSize: 12, fontWeight: 700 },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", color: MUTED, fontSize: 8 },
});

type T = (key: string, values?: Record<string, string | number>) => string;

async function translatorFor(locale: string): Promise<T> {
  const lang = locale.toLowerCase().startsWith("fr") ? "fr" : "en";
  const messages = (await import(`../../messages/${lang}.json`)).default;
  return createTranslator({ locale: lang, messages, namespace: "fees.pdf" }) as unknown as T;
}

export interface SchoolInfo {
  name: string;
  locale: string;
  currency: string;
  dateStyle: "short" | "medium" | "long";
  /** The school's logo, brand colour and contact line, when set. */
  branding?: DocBranding | null;
}

export interface InvoiceDoc {
  school: SchoolInfo;
  invoiceNo: string;
  status: "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";
  student: { name: string; admissionNo: string; className: string | null };
  period: string;
  issueDate: Date;
  dueDate: Date;
  lines: { kind: string; description: string; amountMinor: number }[];
  totalMinor: number;
  paidMinor: number;
  payments: { receiptNo: string | null; date: Date; method: string; amountMinor: number; reversal: boolean }[];
  cancelReason: string | null;
}

export interface ReceiptDoc {
  school: SchoolInfo;
  receiptNo: string;
  date: Date;
  student: { name: string; admissionNo: string; className: string | null };
  invoiceNo: string;
  period: string;
  method: string;
  reference: string | null;
  amountMinor: number;
  balanceAfterMinor: number;
  recordedBy: string | null;
  reversed: boolean;
}

function fmt(school: SchoolInfo) {
  // The currency's own decimals (NGN 2, XOF 0) — documents show exact amounts.
  const money = new Intl.NumberFormat(school.locale, { style: "currency", currency: school.currency });
  const date = new Intl.DateTimeFormat(school.locale, { dateStyle: school.dateStyle, timeZone: "UTC" });
  return {
    money: (minor: number) => (minor < 0 ? `−${money.format(-minor / 100)}` : money.format(minor / 100)),
    date: (d: Date) => date.format(d),
  };
}

function Header({ school, title, number }: { school: SchoolInfo; title: string; number: string }) {
  const b = school.branding;
  return (
    <View style={[s.header, b?.color ? { borderBottomColor: b.color } : {}]}>
      <View style={s.brand}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        {b?.logo ? <Image src={b.logo} style={s.logo} /> : null}
        <View>
          <Text style={s.school}>{school.name}</Text>
          {b?.contactLine ? <Text style={s.contact}>{b.contactLine}</Text> : null}
        </View>
      </View>
      <View>
        <Text style={s.docTitle}>{title}</Text>
        <Text style={s.docNo}>{number}</Text>
      </View>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

function Footer({ t, generated }: { t: T; generated: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{t("generated", { when: generated })}</Text>
      <Text render={({ pageNumber, totalPages }) => t("page", { page: pageNumber, pages: totalPages })} />
    </View>
  );
}

export async function renderInvoicePdf(doc: InvoiceDoc): Promise<Buffer> {
  const t = await translatorFor(doc.school.locale);
  const f = fmt(doc.school);
  const family = pdfFontFamily();
  const balance = doc.status === "CANCELLED" ? 0 : doc.totalMinor - doc.paidMinor;
  const label = (l: InvoiceDoc["lines"][number]) =>
    l.kind === "DISCOUNT" ? t("discountLine", { name: l.description }) : l.kind === "ADJUSTMENT" ? t("adjustmentLine", { name: l.description }) : l.description;
  return renderToBuffer(
    <Document title={`${doc.invoiceNo} · ${doc.student.name}`} author={doc.school.name} language={doc.school.locale}>
      <Page size="A4" style={[s.page, { fontFamily: family }]}>
        <Header school={doc.school} title={t("invoiceTitle")} number={doc.invoiceNo} />
        <View style={s.grid}>
          <Field label={t("student")} value={doc.student.name} />
          <Field label={t("admissionNo")} value={doc.student.admissionNo} />
          <Field label={t("class")} value={doc.student.className ?? "—"} />
          <Field label={t("period")} value={doc.period} />
          <Field label={t("issued")} value={f.date(doc.issueDate)} />
          <Field label={t("due")} value={f.date(doc.dueDate)} />
        </View>
        <View style={s.table}>
          <View style={s.headRow}>
            <Text style={[s.cell, s.desc, s.bold]}>{t("item")}</Text>
            <Text style={[s.cell, s.amt, s.bold]}>{t("amount")}</Text>
          </View>
          {doc.lines.map((l, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={[s.cell, s.desc, l.kind === "FEE" ? {} : s.muted]}>{label(l)}</Text>
              <Text style={[s.cell, s.amt]}>{f.money(l.amountMinor)}</Text>
            </View>
          ))}
          <View style={s.totalRow}>
            <Text style={[s.cell, s.desc, s.bold]}>{t("total")}</Text>
            <Text style={[s.cell, s.amt, s.bold]}>{f.money(doc.totalMinor)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={[s.cell, s.desc]}>{t("paid")}</Text>
            <Text style={[s.cell, s.amt]}>{f.money(doc.paidMinor)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={[s.cell, s.desc, s.bold]}>{t("balance")}</Text>
            <Text style={[s.cell, s.amt, s.bold]}>{f.money(balance)}</Text>
          </View>
        </View>
        {doc.payments.length ? (
          <View style={s.table}>
            <View style={s.headRow}>
              <Text style={[s.cell, { width: 90 }, s.bold]}>{t("date")}</Text>
              <Text style={[s.cell, s.desc, s.bold]}>{t("receipt")}</Text>
              <Text style={[s.cell, s.amt, s.bold]}>{t("amount")}</Text>
            </View>
            {doc.payments.map((p, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={[s.cell, { width: 90 }]}>{f.date(p.date)}</Text>
                <Text style={[s.cell, s.desc]}>{p.reversal ? t("reversal") : `${p.receiptNo ?? ""} · ${p.method}`}</Text>
                <Text style={[s.cell, s.amt]}>{f.money(p.amountMinor)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {doc.status === "CANCELLED" ? (
          <Text style={[s.stamp, { color: "#b91c1c", borderColor: "#b91c1c" }]}>{t("cancelledStamp", { reason: doc.cancelReason ?? "" })}</Text>
        ) : doc.status === "PAID" ? (
          <Text style={[s.stamp, { color: "#15803d", borderColor: "#15803d" }]}>{t("paidStamp")}</Text>
        ) : (
          <Text style={s.muted}>{t("payBy", { date: f.date(doc.dueDate), invoice: doc.invoiceNo })}</Text>
        )}
        <Footer t={t} generated={f.date(new Date())} />
      </Page>
    </Document>,
  );
}

export async function renderReceiptPdf(doc: ReceiptDoc): Promise<Buffer> {
  const t = await translatorFor(doc.school.locale);
  const f = fmt(doc.school);
  const family = pdfFontFamily();
  return renderToBuffer(
    <Document title={`${doc.receiptNo} · ${doc.student.name}`} author={doc.school.name} language={doc.school.locale}>
      <Page size="A5" orientation="landscape" style={[s.page, { fontFamily: family }]}>
        <Header school={doc.school} title={t("receiptTitle")} number={doc.receiptNo} />
        <Text style={s.muted}>{t("received")}</Text>
        <Text style={[s.big, { marginBottom: 10 }]}>{f.money(doc.amountMinor)}</Text>
        <View style={s.grid}>
          <Field label={t("student")} value={doc.student.name} />
          <Field label={t("admissionNo")} value={doc.student.admissionNo} />
          <Field label={t("class")} value={doc.student.className ?? "—"} />
          <Field label={t("date")} value={f.date(doc.date)} />
          <Field label={t("invoice")} value={doc.invoiceNo} />
          <Field label={t("period")} value={doc.period} />
          <Field label={t("method")} value={doc.method} />
          <Field label={t("reference")} value={doc.reference ?? "—"} />
          <Field label={t("balanceAfter")} value={f.money(doc.balanceAfterMinor)} />
          <Field label={t("recordedBy")} value={doc.recordedBy ?? "—"} />
        </View>
        {doc.reversed ? <Text style={[s.stamp, { color: "#b91c1c", borderColor: "#b91c1c" }]}>{t("reversedStamp")}</Text> : null}
        <Footer t={t} generated={f.date(new Date())} />
      </Page>
    </Document>,
  );
}
