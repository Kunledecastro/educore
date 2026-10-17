import { describe, expect, it } from "vitest";
import { summarizeAttendance } from "./attendance";
import { feeRows, homeworkSummary } from "./pupil-profile";
import type { PupilProfile } from "./pupil-profile-data";
import { renderPupilProfile } from "./pupil-profile-pdf";
import { footerTop, PAGE_HEIGHT } from "./report-card-pdf";
import { parseTenantSettings } from "./tenant-settings";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const now = new Date("2026-10-17T13:00:00Z");

export function sampleProfile(locale = "en-NG", family = false): PupilProfile {
  const fees = feeRows([
    { label: "2026/2027 · First term · INV-2026-00001", status: "PARTIALLY_PAID", subtotal: "150000", discountTotal: "15000", totalDue: "135000", amountPaid: "100000" },
  ]);
  return {
    school: { name: "Greenfield Academy", settings: parseTenantSettings({ locale }) },
    generatedAt: now,
    generatedBy: "Mrs Adaeze Okafor",
    family,
    sections: ["details", ...(family ? [] : (["guardians"] as const)), "attendance", "results", "homework", "fees", "health"],
    pupil: {
      id: "s1",
      name: "Adébáyọ̀ Ọlábísí",
      admissionNo: "GA-2026-0001",
      className: "JSS 2 A",
      status: "ACTIVE",
      dateOfBirth: d("2014-03-02"),
      age: 12,
      gender: "MALE",
      admissionDate: d("2025-09-08"),
      leftAt: null,
      formTeacher: "Chinedu Eze",
    },
    guardians: family ? undefined : [{ name: "Ngozi Ọlábísí", relationship: "MOTHER", isPrimary: true, phone: "+234 803 000 0000", email: "ngozi@example.com" }],
    years: [
      {
        id: "y2",
        name: "2026/2027",
        current: true,
        className: "JSS 2 A",
        attendance: { terms: [{ termId: "t1", name: "First term", counts: summarizeAttendance(["PRESENT", "PRESENT", "LATE", "ABSENT"]) }], year: summarizeAttendance(["PRESENT", "PRESENT", "LATE", "ABSENT"]) },
        results: [
          {
            termId: "t1",
            name: "First term",
            published: false,
            subjects: [
              { name: "English", total: 75, complete: true, grade: "A", remark: "Excellent" },
              { name: "Mathematics", total: 18, complete: false, grade: null, remark: null },
            ],
            average: 75,
            subjectCount: 1,
            incomplete: 1,
            position: 3,
            positionOutOf: 24,
          },
        ],
        homework: {
          terms: [{ name: "First term", summary: homeworkSummary([{ dueAt: d("2026-10-01"), maxScore: 10, marksReleased: true, submission: { status: "MARKED", isLate: false, isMissing: false, score: 8 } }], now, { family }) }],
          year: homeworkSummary([{ dueAt: d("2026-10-01"), maxScore: 10, marksReleased: true, submission: { status: "MARKED", isLate: false, isMissing: false, score: 8 } }], now, { family }),
        },
      },
      {
        id: "y1",
        name: "2025/2026",
        current: false,
        className: "JSS 1 B",
        attendance: { terms: [], year: summarizeAttendance(["PRESENT", "EXCUSED"]) },
      },
    ],
    fees: { ...fees, currency: "NGN" },
    health: [
      { category: "ALLERGY", severity: "SEVERE", text: "Severe peanut allergy, EpiPen in bag; call nurse and parent" },
      { category: "ASTHMA", severity: "MILD", text: "Inhaler in locker" },
    ],
  };
}

describe("renderPupilProfile", () => {
  it("renders a PDF with the bundled Noto Sans font (₦, Ọ, ẹ)", async () => {
    const pdf = await renderPupilProfile(sampleProfile());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toMatch(/NotoSans/);
  }, 30_000);

  it("renders for a parent and in French", async () => {
    expect((await renderPupilProfile(sampleProfile("fr-SN", true))).subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);

  it("renders a profile with no records and no optional sections", async () => {
    const p = sampleProfile();
    const pdf = await renderPupilProfile({ ...p, sections: ["details"], years: [], guardians: undefined, fees: undefined, health: undefined });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});

describe("footerTop", () => {
  // react-pdf drops a bottom-anchored fixed footer when the page sets a lineHeight, so footers sit from the top.
  it("places a footer inside the bottom margin, above the page edge", () => {
    const top = footerTop(PAGE_HEIGHT.A4, 18, 7);
    expect(top).toBeGreaterThan(PAGE_HEIGHT.A4 - 44);
    expect(top + 7 * 1.4).toBeLessThanOrEqual(PAGE_HEIGHT.A4 - 18);
    expect(footerTop(PAGE_HEIGHT.A5_LANDSCAPE, 24, 8)).toBeCloseTo(384.33, 2);
  });
});
