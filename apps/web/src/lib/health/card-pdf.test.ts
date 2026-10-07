import { describe, expect, it } from "vitest";
import { renderEmergencyCardsPdf } from "./card-pdf";
import type { EmergencyCardsDoc } from "./card";

/** The emergency card PDF renders in both languages, for basic and full cards, and with no pupils. */
const doc = (locale: string, cards: EmergencyCardsDoc["cards"]): EmergencyCardsDoc => ({
  school: { name: "Greenfield Academy", locale, branding: null },
  title: "JSS1 A",
  generatedAt: new Date("2026-10-07T10:00:00Z"),
  timezone: "Africa/Lagos",
  cards,
});

const basic: EmergencyCardsDoc["cards"][number] = {
  level: "basic",
  name: "Adaeze Okafor",
  admissionNo: "GFA/001",
  className: "JSS1 A",
  alerts: [{ category: "ALLERGY", severity: "SEVERE", text: "Severe peanut allergy — EpiPen in bag; call nurse and parent" }],
  contacts: [{ name: "Mrs Okafor", relationship: "Mother", phone: "+234 803 000 0000", altPhone: null }],
  full: null,
};
const full: EmergencyCardsDoc["cards"][number] = {
  ...basic,
  level: "full",
  full: { bloodGroup: "O+", genotype: "AS", allergies: [{ name: "Peanuts", reaction: "Swelling", severity: "severe" }], medications: [{ name: "Salbutamol", dose: "2 puffs", schedule: "as needed", atSchool: true }], permittedMedicines: ["paracetamol", "ors"] },
};

describe("emergency card PDF", () => {
  it.each(["en-NG", "fr-SN"])("renders basic and full cards (%s)", async (locale) => {
    const pdf = await renderEmergencyCardsPdf(doc(locale, [basic, full]));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("renders an empty class", async () => {
    const pdf = await renderEmergencyCardsPdf(doc("en-NG", []));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
