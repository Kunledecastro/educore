import { brandCss, normaliseHex } from "@/lib/branding";

/**
 * A school's brand colour applied to the whole app (buttons, links, focus
 * rings, active menu item), light and dark mode. The values are numbers
 * computed from a validated #rrggbb colour, so nothing a school typed ever
 * reaches the stylesheet as-is.
 */
export function BrandStyle({ color }: { color: string | null }) {
  const hex = color ? normaliseHex(color) : null;
  if (!hex) return null;
  const css = brandCss(hex);
  const block = (vars: Record<string, string>) =>
    Object.entries(vars)
      .map(([k, v]) => `${k}: ${v};`)
      .join(" ");
  return <style>{`:root { ${block(css.light)} } .dark { ${block(css.dark)} }`}</style>;
}
