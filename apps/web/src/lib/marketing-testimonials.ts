/**
 * Quotes for the landing page (Phase 9.2). Real schools only, with their
 * permission to be named. The section is hidden while this list is empty —
 * never put placeholder or invented quotes here.
 */
export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  school: string;
  /** Optional photo under /public/testimonials/. */
  photo?: string;
}

export const TESTIMONIALS: readonly Testimonial[] = [];
