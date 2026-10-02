import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";
import type { ReportSnapshot } from "./report-card";

/**
 * Report card PDF (milestone 2.3), drawn from a frozen snapshot. A4, one
 * page per student (long subject lists flow onto a second page). Labels
 * follow the SCHOOL's language (from its locale), not the viewer's.
 */

let fontFamily = "Helvetica";
let fontsTried = false;
/** Noto Sans covers Ọ, ẹ, ṣ, ₦… (Helvetica doesn't). Falls back to Helvetica if the files aren't deployed. */
function ensureFonts() {
  if (fontsTried) return;
  fontsTried = true;
  const candidates = [path.join(process.cwd(), "assets/fonts"), path.join(process.cwd(), "apps/web/assets/fonts")];
  const dir = candidates.find((d) => existsSync(path.join(d, "NotoSans-Regular.ttf")));
  if (!dir) {
    console.warn("[report-card-pdf] Noto Sans not found; using Helvetica (some characters may not render)");
    return;
  }
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: path.join(dir, "NotoSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]); // don't hyphenate names
  fontFamily = "NotoSans";
}

const INK = "#1f2937";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const SHADE = "#f3f4f6";

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, color: INK, lineHeight: 1.35 },
  header: { borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 8, marginBottom: 10 },
  school: { fontSize: 16, fontWeight: 700, lineHeight: 1.25 },
  title: { fontSize: 11, marginTop: 4, lineHeight: 1.25 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  field: { width: "50%", flexDirection: "row", marginBottom: 2 },
  label: { color: MUTED, width: 90 },
  value: { fontWeight: 700, flex: 1 },
  table: { borderWidth: 1, borderColor: RULE, marginBottom: 10 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: RULE },
  headRow: { flexDirection: "row", backgroundColor: SHADE, borderBottomWidth: 1, borderBottomColor: RULE },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  num: { textAlign: "right" },
  bold: { fontWeight: 700 },
  section: { fontSize: 10, fontWeight: 700, marginBottom: 4, marginTop: 2 },
  boxes: { flexDirection: "row", gap: 8, marginBottom: 10 },
  box: { flex: 1, borderWidth: 1, borderColor: RULE, padding: 6 },
  big: { fontSize: 14, fontWeight: 700, lineHeight: 1.25, marginVertical: 2 },
  comment: { borderWidth: 1, borderColor: RULE, padding: 6, marginBottom: 8, minHeight: 36 },
  muted: { color: MUTED },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", color: MUTED, fontSize: 7 },
});

/** Translator for `reportCards.pdf.*` keys (ICU messages: plurals, ordinals). */
type T = (key: string, values?: Record<string, string | number>) => string;

async function translatorFor(locale: string): Promise<T> {
  const lang = locale.toLowerCase().startsWith("fr") ? "fr" : "en";
  const messages = (await import(`../../messages/${lang}.json`)).default;
  return createTranslator({ locale: lang, messages, namespace: "reportCards.pdf" }) as unknown as T;
}

function Card({ snap, t }: { snap: ReportSnapshot; t: T }) {
  const nf = new Intl.NumberFormat(snap.school.locale, { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(snap.school.locale, { dateStyle: snap.school.dateStyle, timeZone: "UTC" });
  const n = (v: number | null) => (v === null ? "—" : nf.format(v));
  const date = (iso: string) => df.format(new Date(`${iso}T00:00:00Z`));
  const comps = snap.components;
  // Column widths: subject 30%, components share 30%, total 10%, grade 8%, remark 12%, class avg 10%.
  const compW = `${30 / Math.max(comps.length, 1)}%`;
  const a = snap.attendance;

  return (
    <Page size="A4" style={[s.page, { fontFamily }]} wrap>
      <View style={s.header}>
        <Text style={s.school}>{snap.school.name}</Text>
        <Text style={s.title}>{t("title", { term: snap.period.term, year: snap.period.year })}</Text>
      </View>

      <View style={s.grid}>
        <View style={s.field}><Text style={s.label}>{t("student")}</Text><Text style={s.value}>{snap.student.name}</Text></View>
        <View style={s.field}><Text style={s.label}>{t("admissionNo")}</Text><Text style={s.value}>{snap.student.admissionNo}</Text></View>
        <View style={s.field}><Text style={s.label}>{t("class")}</Text><Text style={s.value}>{`${snap.student.className}${snap.student.sectionName ? ` ${snap.student.sectionName}` : ""}`}</Text></View>
        <View style={s.field}><Text style={s.label}>{t("termDates")}</Text><Text style={s.value}>{`${date(snap.period.from)} – ${date(snap.period.to)}`}</Text></View>
      </View>

      <View style={s.table}>
        <View style={s.headRow} fixed>
          <Text style={[s.cell, s.bold, { width: "30%" }]}>{t("subject")}</Text>
          {comps.map((c, i) => (
            <Text key={i} style={[s.cell, s.bold, s.num, { width: compW }]}>{`${c.name} (${nf.format(c.weight)})`}</Text>
          ))}
          <Text style={[s.cell, s.bold, s.num, { width: "10%" }]}>{t("total")}</Text>
          <Text style={[s.cell, s.bold, { width: "8%" }]}>{t("grade")}</Text>
          <Text style={[s.cell, s.bold, { width: "12%" }]}>{t("remark")}</Text>
          <Text style={[s.cell, s.bold, s.num, { width: "10%" }]}>{t("classAverage")}</Text>
        </View>
        {snap.subjects.length === 0 ? (
          <Text style={[s.cell, s.muted]}>{t("noSubjects")}</Text>
        ) : (
          snap.subjects.map((x, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={[s.cell, { width: "30%" }]}>{x.name}</Text>
              {comps.map((_, ci) => (
                <Text key={ci} style={[s.cell, s.num, { width: compW }]}>{n(x.parts[ci] ?? null)}</Text>
              ))}
              <Text style={[s.cell, s.num, s.bold, { width: "10%" }]}>{`${n(x.total)}${x.total !== null && !x.complete ? "*" : ""}`}</Text>
              <Text style={[s.cell, s.bold, { width: "8%" }]}>{x.grade ?? "—"}</Text>
              <Text style={[s.cell, { width: "12%" }]}>{x.remark ?? ""}</Text>
              <Text style={[s.cell, s.num, s.muted, { width: "10%" }]}>{n(x.classAverage)}</Text>
            </View>
          ))
        )}
      </View>
      {snap.summary.incomplete > 0 ? <Text style={[s.muted, { marginTop: -6, marginBottom: 8 }]}>{t("incompleteNote")}</Text> : null}

      <View style={s.boxes} wrap={false}>
        <View style={s.box}>
          <Text style={s.muted}>{t("average")}</Text>
          <Text style={s.big}>{n(snap.summary.average)}</Text>
          <Text style={s.muted}>{t("subjectsCounted", { count: snap.summary.subjects })}</Text>
        </View>
        {snap.summary.position !== null ? (
          <View style={s.box}>
            <Text style={s.muted}>{t("position")}</Text>
            <Text style={s.big}>{t("positionValue", { position: snap.summary.position, total: snap.summary.positionOutOf })}</Text>
          </View>
        ) : null}
        <View style={[s.box, { flex: 2 }]}>
          <Text style={s.muted}>{t("attendance")}</Text>
          <Text style={s.big}>{a.rate === null ? "—" : `${nf.format(a.rate)}%`}</Text>
          <Text style={s.muted}>{t("attendanceCounts", { present: a.present, absent: a.absent, late: a.late, excused: a.excused })}</Text>
        </View>
      </View>

      <View wrap={false}>
        <Text style={s.section}>{snap.comments.teacherName ? t("teacherCommentBy", { name: snap.comments.teacherName }) : t("teacherComment")}</Text>
        <Text style={s.comment}>{snap.comments.teacher ?? ""}</Text>
        <Text style={s.section}>{t("principalComment")}</Text>
        <Text style={s.comment}>{snap.comments.principal ?? ""}</Text>
      </View>

      <View wrap={false} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
        <Text>{snap.period.nextTermStarts ? t("nextTerm", { date: date(snap.period.nextTermStarts) }) : ""}</Text>
        <Text style={s.muted}>
          {t("key")}: {snap.gradingKey.map((g) => `${g.grade} ${nf.format(g.minScore)}–${nf.format(g.maxScore)}`).join(" · ")}
        </Text>
      </View>

      <View style={s.footer} fixed>
        <Text>{t("generated", { date: date(snap.generatedAt.slice(0, 10)) })}</Text>
        <Text render={({ pageNumber, totalPages }) => t("page", { page: pageNumber, total: totalPages })} />
      </View>
    </Page>
  );
}

/** One PDF holding every given card (one per student, in order). */
export async function renderReportCards(snapshots: ReportSnapshot[], title: string): Promise<Buffer> {
  ensureFonts();
  const t = await translatorFor(snapshots[0]?.school.locale ?? "en");
  return renderToBuffer(
    <Document title={title} author={snapshots[0]?.school.name ?? "EduCore"} creator="EduCore" producer="EduCore">
      {snapshots.map((snap, i) => (
        <Card key={i} snap={snap} t={t} />
      ))}
    </Document>,
  );
}

/** Safe file name piece: "Amaka Okonkwo" → "amaka-okonkwo". */
export function fileSlug(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "report-card"
  );
}
