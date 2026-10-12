import { describe, expect, it } from "vitest";
import { parseSupportContacts, telLink, whatsappLink } from "./support";

describe("support contacts", () => {
  it("accepts a WhatsApp number written the usual ways and keeps digits only", () => {
    expect(parseSupportContacts({ NEXT_PUBLIC_SUPPORT_WHATSAPP: "+234 801 234 5678" }).whatsapp).toBe("2348012345678");
    expect(parseSupportContacts({ NEXT_PUBLIC_SUPPORT_WHATSAPP: "(234) 801-234-5678" }).whatsapp).toBe("2348012345678");
  });

  it("hides anything missing or malformed rather than showing a broken link", () => {
    expect(parseSupportContacts({})).toEqual({ whatsapp: null, email: null, phone: null });
    expect(parseSupportContacts({ NEXT_PUBLIC_SUPPORT_WHATSAPP: "0801", NEXT_PUBLIC_SUPPORT_EMAIL: "not-an-email", NEXT_PUBLIC_SUPPORT_PHONE: "call us" })).toEqual({ whatsapp: null, email: null, phone: null });
    expect(parseSupportContacts({ NEXT_PUBLIC_SUPPORT_EMAIL: "a@b.com\"><script>" }).email).toBeNull();
  });

  it("builds click-to-chat and dial links with the text encoded", () => {
    expect(whatsappLink("2348012345678", "Hello & welcome?")).toBe("https://wa.me/2348012345678?text=Hello%20%26%20welcome%3F");
    expect(telLink("+234 801 234 5678")).toBe("tel:+2348012345678");
  });
});
