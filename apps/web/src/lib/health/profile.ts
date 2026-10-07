import { z } from "zod";

/**
 * A pupil's health profile (Phase 7.0): what parents tell the school and the
 * nurse checks. Stored as ONE encrypted JSON document, so its shape is
 * defined (and validated) here. Messages are i18n keys.
 */

export const CONSENT_VERSION = "2026-10-v1";

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"] as const;
export const GENOTYPES = ["AA", "AS", "AC", "SS", "SC", "unknown"] as const;
export const SEVERITIES = ["mild", "moderate", "severe"] as const;
/** Common medicines a parent can allow the clinic to give (7.2). */
export const PERMITTABLE_MEDICINES = ["paracetamol", "ibuprofen", "antacid", "ors", "antihistamine", "antiseptic"] as const;

const text = (max: number) => z.string().trim().max(max, "validation.tooLong");
const required = (max: number) => text(max).min(1, "validation.required");

export const allergySchema = z.object({ name: required(120), reaction: text(300).default(""), severity: z.enum(SEVERITIES) });
export const conditionSchema = z.object({ name: required(120), notes: text(1000).default("") });
export const medicationSchema = z.object({ name: required(120), dose: text(120).default(""), schedule: text(200).default(""), atSchool: z.boolean().default(false) });
export const immunisationSchema = z.object({ name: required(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "validation.invalidDate").or(z.literal("")).default("") });

export const healthProfileSchema = z.object({
  bloodGroup: z.enum(BLOOD_GROUPS).default("unknown"),
  genotype: z.enum(GENOTYPES).default("unknown"),
  allergies: z.array(allergySchema).max(20).default([]),
  conditions: z.array(conditionSchema).max(20).default([]),
  medications: z.array(medicationSchema).max(20).default([]),
  immunisations: z.array(immunisationSchema).max(40).default([]),
  doctor: z.object({ name: text(120).default(""), hospital: text(160).default(""), phone: text(30).default("") }).default({}),
  hmo: z.object({ provider: text(120).default(""), number: text(60).default("") }).default({}),
  permittedMedicines: z.array(z.enum(PERMITTABLE_MEDICINES)).max(PERMITTABLE_MEDICINES.length).default([]),
  notes: text(2000).default(""),
});
export type HealthProfileData = z.infer<typeof healthProfileSchema>;
export type HealthProfileInput = z.input<typeof healthProfileSchema>;

export const emergencyContactSchema = z.object({
  name: required(120),
  relationship: text(60).default(""),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{5,30}$/, "validation.phone"),
  altPhone: z.string().trim().regex(/^\+?[0-9 ()-]{5,30}$/, "validation.phone").or(z.literal("")).default(""),
});
export const emergencyContactsSchema = z.array(emergencyContactSchema).max(5);
export type EmergencyContactInput = z.input<typeof emergencyContactSchema>;

export const EMPTY_PROFILE: HealthProfileData = healthProfileSchema.parse({});

/** Has anything clinically meaningful been entered? (An empty form isn't worth storing.) */
export function isEmptyProfile(p: HealthProfileData): boolean {
  return (
    p.bloodGroup === "unknown" &&
    p.genotype === "unknown" &&
    !p.allergies.length &&
    !p.conditions.length &&
    !p.medications.length &&
    !p.immunisations.length &&
    !p.doctor.name &&
    !p.doctor.hospital &&
    !p.doctor.phone &&
    !p.hmo.provider &&
    !p.hmo.number &&
    !p.permittedMedicines.length &&
    !p.notes
  );
}
