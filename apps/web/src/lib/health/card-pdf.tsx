import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";
import { pdfFontFamily } from "../report-card-pdf";
import type { EmergencyCard, EmergencyCardsDoc } from "./card";

/**
 * Emergency cards as a PDF (Phase 7.1): A4, one bordered card per pupil
 * (never split across pages), labels in the school's language. Severe
 * alerts are marked in red text *and* with the word "Severe", so the card
 * still reads correctly when printed in black and white.
 */

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#9ca3af";
const RED = "#b91c1c";

const s = StyleSheet.create({
  page: { padding: 30, fontSize: 9.5, color: INK, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 8, marginBottom: 12 },
  brand: { flexDirection: "row", alignItems: "center", maxWidth: "62%" },
  logo: { width: 34, height: 34, objectFit: "contain", marginRight: 8 },
  school: { fontSize: 13, fontWeight: 700 },
  title: { fontSize: 12, fontWeight: 700, textAlign: "right" },
  subtitle: { fontSize: 8.5, color: MUTED, textAlign: "right" },
  card: { borderWidth: 1.5, borderColor: INK, borderRadius: 4, padding: 10, marginBottom: 10 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.75, borderBottomColor: RULE, paddingBottom: 4, marginBottom: 6 },
  name: { fontSize: 12, fontWeight: 700 },
  meta: { fontSize: 8.5, color: MUTED },
  section: { marginBottom: 5 },
  h: { fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 2 },
  row: { flexDirection: "row" },
  half: { width: "50%", paddingRight: 6 },
  alert: { flexDirection: "row", marginBottom: 2 },
  sev: { width: 62, fontWeight: 700 },
  severe: { color: RED },
  none: { color: MUTED },
  confidential: { fontSize: 7.5, color: MUTED, marginTop: 4 },
  footer: { position: "absolute", bottom: 16, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", color: MUTED, fontSize: 7.5 },
  empty: { marginTop: 20, color: MUTED },
});

type T = (key: string, values?: Record<string, string | number>) => string;

async function translatorFor(locale: string): Promise<T> {
  const lang = locale.toLowerCase().startsWith("fr") ? "fr" : "en";
  const messages = (await import(`../../../messages/${lang}.json`)).default;
  return createTranslator({ locale: lang, messages, namespace: "health" }) as unknown as T;
}

function Card({ c, t }: { c: EmergencyCard; t: T }) {
  const unknown = (x: string) => (x === "unknown" ? t("profile.unknown") : x);
  return (
    <View style={s.card} wrap={false}>
      <View style={s.cardTop}>
        <View>
          <Text style={s.name}>{c.name}</Text>
          <Text style={s.meta}>
            {c.admissionNo}
            {c.className ? ` · ${c.className}` : ""}
          </Text>
        </View>
        {c.full ? (
          <View>
            <Text style={s.meta}>
              {t("profile.bloodGroup")}: <Text style={{ color: INK, fontWeight: 700 }}>{unknown(c.full.bloodGroup)}</Text>
            </Text>
            <Text style={s.meta}>
              {t("profile.genotype")}: <Text style={{ color: INK, fontWeight: 700 }}>{unknown(c.full.genotype)}</Text>
            </Text>
          </View>
        ) : null}
      </View>

      <View style={s.section}>
        <Text style={s.h}>{t("card.alerts")}</Text>
        {c.alerts.length ? (
          c.alerts.map((a, i) => (
            <View key={i} style={s.alert}>
              <Text style={a.severity === "SEVERE" ? [s.sev, s.severe] : s.sev}>{t(`alerts.severity.${a.severity}`)}</Text>
              <Text style={{ flex: 1 }}>
                <Text style={{ fontWeight: 700 }}>{t(`alerts.category.${a.category}`)}: </Text>
                {a.text}
              </Text>
            </View>
          ))
        ) : (
          <Text style={s.none}>{t("card.noAlerts")}</Text>
        )}
      </View>

      {c.full ? (
        <View style={[s.row, s.section]}>
          <View style={s.half}>
            <Text style={s.h}>{t("profile.allergies")}</Text>
            {c.full.allergies.length ? (
              c.full.allergies.map((a, i) => (
                <Text key={i}>
                  <Text style={a.severity === "severe" ? [{ fontWeight: 700 }, s.severe] : { fontWeight: 700 }}>{a.name}</Text> ({t(`profile.severity.${a.severity}`)}){a.reaction ? ` — ${a.reaction}` : ""}
                </Text>
              ))
            ) : (
              <Text style={s.none}>{t("profile.none")}</Text>
            )}
          </View>
          <View style={s.half}>
            <Text style={s.h}>{t("profile.medications")}</Text>
            {c.full.medications.length ? (
              c.full.medications.map((m, i) => (
                <Text key={i}>
                  <Text style={{ fontWeight: 700 }}>{m.name}</Text>
                  {[m.dose, m.schedule].filter(Boolean).length ? ` — ${[m.dose, m.schedule].filter(Boolean).join(", ")}` : ""}
                  {m.atSchool ? ` (${t("profile.atSchool")})` : ""}
                </Text>
              ))
            ) : (
              <Text style={s.none}>{t("profile.none")}</Text>
            )}
            <Text style={[s.h, { marginTop: 4 }]}>{t("profile.permitted")}</Text>
            <Text>{c.full.permittedMedicines.length ? c.full.permittedMedicines.map((m) => t(`profile.medicines.${m}`)).join(", ") : t("profile.permittedNone")}</Text>
          </View>
        </View>
      ) : null}

      <View>
        <Text style={s.h}>{t("contacts.title")}</Text>
        {c.contacts.length ? (
          c.contacts.map((x, i) => (
            <Text key={i}>
              {i + 1}. <Text style={{ fontWeight: 700 }}>{x.name}</Text>
              {x.relationship ? ` (${x.relationship})` : ""} — <Text style={{ fontWeight: 700 }}>{x.phone}</Text>
              {x.altPhone ? ` · ${x.altPhone}` : ""}
            </Text>
          ))
        ) : (
          <Text style={s.none}>{t("contacts.none")}</Text>
        )}
      </View>
      <Text style={s.confidential}>{c.full ? t("card.confidentialFull") : t("card.confidentialBasic")}</Text>
    </View>
  );
}

export async function renderEmergencyCardsPdf(doc: EmergencyCardsDoc): Promise<Buffer> {
  const t = await translatorFor(doc.school.locale);
  const fontFamily = pdfFontFamily();
  const generated = new Intl.DateTimeFormat(doc.school.locale, { dateStyle: "medium", timeStyle: "short", timeZone: doc.timezone }).format(doc.generatedAt);
  const b = doc.school.branding;
  return renderToBuffer(
    <Document title={`${t("card.title")} — ${doc.title}`} author={doc.school.name}>
      <Page size="A4" style={[s.page, { fontFamily }]}>
        <View style={[s.header, b?.color ? { borderBottomColor: b.color } : {}]} fixed>
          <View style={s.brand}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {b?.logo ? <Image src={b.logo} style={s.logo} /> : null}
            <Text style={s.school}>{doc.school.name}</Text>
          </View>
          <View>
            <Text style={s.title}>{t("card.title")}</Text>
            <Text style={s.subtitle}>{doc.title}</Text>
          </View>
        </View>
        {doc.cards.length ? doc.cards.map((c, i) => <Card key={i} c={c} t={t} />) : <Text style={s.empty}>{t("card.empty")}</Text>}
        <View style={s.footer} fixed>
          <Text>{t("card.generated", { when: generated })}</Text>
          <Text render={({ pageNumber, totalPages }) => t("card.page", { page: pageNumber, pages: totalPages })} />
        </View>
      </Page>
    </Document>,
  );
}
