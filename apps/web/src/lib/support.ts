/**
 * How schools reach the EduCore team (tester review, Oct 2026). Set in the
 * environment so the number and address can change without a code change;
 * anything not set simply isn't shown. Public values (NEXT_PUBLIC_*), safe
 * in the browser.
 */

export interface SupportContacts {
  /** International format, digits only (e.g. 2348012345678). */
  whatsapp: string | null;
  email: string | null;
  /** As it should be displayed and dialled (e.g. +234 801 234 5678). */
  phone: string | null;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function parseSupportContacts(env: Record<string, string | undefined>): SupportContacts {
  const wa = (env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "").replace(/[\s+()-]/g, "");
  const email = (env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "").trim();
  const phone = (env.NEXT_PUBLIC_SUPPORT_PHONE ?? "").trim();
  return {
    whatsapp: /^\d{10,15}$/.test(wa) ? wa : null,
    email: EMAIL.test(email) && email.length <= 200 ? email : null,
    phone: /^\+?[\d\s()-]{7,20}$/.test(phone) ? phone : null,
  };
}

// Read with literal names so Next.js inlines them into browser code too.
export const SUPPORT: SupportContacts = parseSupportContacts({
  NEXT_PUBLIC_SUPPORT_WHATSAPP: process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP,
  NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
  NEXT_PUBLIC_SUPPORT_PHONE: process.env.NEXT_PUBLIC_SUPPORT_PHONE,
});

/** A click-to-chat link with the first message filled in (the person can edit it before sending). */
export function whatsappLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message.slice(0, 500))}`;
}

export function telLink(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
