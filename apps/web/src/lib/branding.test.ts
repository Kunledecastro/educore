import { describe, expect, it } from "vitest";
import { BRAND_PRESETS, brandCss, checkLogo, contrastRatio, darkModeVariant, detectLogoType, foregroundFor, hslTriplet, LOGO_MAX_BYTES, logoUrl, normaliseHex, parseBranding } from "./branding";

describe("brand colours", () => {
  it("accepts #rgb and #rrggbb, nothing else", () => {
    expect(normaliseHex("#0F766E")).toBe("#0f766e");
    expect(normaliseHex(" #abc ")).toBe("#aabbcc");
    for (const bad of ["0f766e", "#12345", "#gggggg", "red", "#0f766e; color: red", "url(x)"]) expect(normaliseHex(bad)).toBeNull();
  });

  it("text on any colour meets WCAG AA (4.5:1)", () => {
    for (const c of [...BRAND_PRESETS, "#ffff00", "#777777", "#808080", "#00ff00", "#000000", "#ffffff", "#ff8800"]) {
      expect(contrastRatio(c, foregroundFor(c))).toBeGreaterThanOrEqual(4.5);
    }
    expect(foregroundFor("#0f766e")).toBe("#ffffff");
    expect(foregroundFor("#ffff00")).toBe("#000000");
  });

  it("dark colours are lightened for dark mode; light ones are left alone", () => {
    expect(contrastRatio(darkModeVariant("#1e3a8a"), "#0b1220")).toBeGreaterThanOrEqual(3);
    expect(darkModeVariant("#ffff00")).toBe("#ffff00");
  });

  it("produces the app's HSL variable format", () => {
    expect(hslTriplet("#ffffff")).toBe("0 0% 100%");
    expect(hslTriplet("#0f766e")).toMatch(/^\d{1,3} \d{1,3}% \d{1,3}%$/);
    const css = brandCss("#1d4ed8");
    expect(Object.keys(css.light)).toEqual(["--primary", "--primary-foreground", "--ring"]);
    for (const v of [...Object.values(css.light), ...Object.values(css.dark)]) expect(v).toMatch(/^\d{1,3} \d{1,3}% \d{1,3}%$/);
  });

  it("reads stored branding defensively", () => {
    expect(parseBranding({ primaryColor: "#0F766E", contactLine: "  12 Allen Ave  ", logoVersion: "abcdef12" })).toEqual({ primaryColor: "#0f766e", contactLine: "12 Allen Ave", logoVersion: "abcdef12" });
    expect(parseBranding({ primaryColor: "javascript:alert(1)", logoVersion: "../x" })).toEqual({ primaryColor: null, contactLine: null, logoVersion: null });
    expect(parseBranding(null)).toEqual({ primaryColor: null, contactLine: null, logoVersion: null });
  });
});

describe("logos", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const gif = new TextEncoder().encode("GIF89a....");

  it("knows PNG and JPEG by their bytes; refuses SVG and everything else", () => {
    expect(detectLogoType(png)).toBe("image/png");
    expect(detectLogoType(jpg)).toBe("image/jpeg");
    expect(detectLogoType(svg)).toBeNull();
    expect(detectLogoType(gif)).toBeNull();
    expect(checkLogo(svg)).toBe("notImage");
  });

  it("refuses empty and oversized files", () => {
    expect(checkLogo(new Uint8Array())).toBe("empty");
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(png);
    expect(checkLogo(big)).toBe("tooLarge");
    expect(checkLogo(png)).toBeNull();
  });

  it("versions the logo URL", () => {
    expect(logoUrl("t1", "abcdef12")).toBe("/api/branding/logo/t1?v=abcdef12");
    expect(logoUrl("t1", null)).toBeNull();
  });
});
