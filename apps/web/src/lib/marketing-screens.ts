/**
 * Screenshots for the landing page's "See it in action" section (tester
 * review, Oct 2026). Real screens of the demo school only — never a real
 * school's pupils. Files live in apps/web/public/screens/. The section is
 * hidden while this list is empty.
 *
 * To add one: save a PNG/WebP (about 1600px wide, light mode, browser
 * chrome cropped) to public/screens/, then add it here with its pixel size.
 */

export const SCREEN_KEYS = ["dashboard", "attendance", "reportCard", "fees", "parent"] as const;
export type ScreenKey = (typeof SCREEN_KEYS)[number];

export interface Screenshot {
  key: ScreenKey;
  /** Path under /public, e.g. "/screens/dashboard.webp". */
  src: string;
  width: number;
  height: number;
}

export const SCREENSHOTS: readonly Screenshot[] = [];
