"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { countFrames, parseCount } from "@/lib/count-up";

/**
 * Scroll motion for the public site (see "Site motion" in globals.css).
 *
 * - Elements marked `data-reveal` fade up the first time they scroll into view.
 * - Elements marked `data-count` (inside or outside a reveal) count up to
 *   their number when they appear, e.g. "30 days", "from ₦300".
 *
 * Nothing is hidden until this runs, anything already on screen is shown
 * straight away (no flash), and nothing happens at all for people whose
 * device asks for reduced motion.
 */
export function MotionScope() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-shown])"));
    const counters = Array.from(document.querySelectorAll<HTMLElement>("[data-count]:not([data-counted])"));
    const inView = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight * 0.92 && r.bottom > 0;
    };
    const cancels: (() => void)[] = [];
    const runCount = (el: HTMLElement) => {
      if (el.dataset.counted) return;
      el.dataset.counted = "1";
      const final = el.textContent ?? "";
      const parsed = parseCount(final);
      if (!parsed) return;
      const frames = countFrames(parsed, 40);
      let i = 0;
      let raf = 0;
      const step = () => {
        el.textContent = frames[i]!;
        i++;
        if (i < frames.length) raf = requestAnimationFrame(step);
        else el.textContent = final;
      };
      raf = requestAnimationFrame(step);
      cancels.push(() => {
        cancelAnimationFrame(raf);
        el.textContent = final;
      });
    };

    // Already on screen: show now, before hiding anything else.
    for (const el of items) if (inView(el)) el.dataset.shown = "1";
    root.classList.add("motion-ready");

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          if (el.hasAttribute("data-reveal")) el.dataset.shown = "1";
          if (el.hasAttribute("data-count")) runCount(el);
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    for (const el of items) if (!el.dataset.shown) io.observe(el);
    for (const el of counters) io.observe(el);

    // Safety net: a fast scroll or a jump (End key, #link) can pass an element
    // without the observer ever seeing it cross. Anything at or above the
    // bottom of the screen is shown, so nothing can stay invisible.
    let ticking = false;
    const sweep = () => {
      ticking = false;
      let left = 0;
      for (const el of items) {
        if (el.dataset.shown) continue;
        if (el.getBoundingClientRect().top < window.innerHeight) {
          el.dataset.shown = "1";
          io.unobserve(el);
        } else left++;
      }
      if (left === 0) window.removeEventListener("scroll", onScroll);
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(sweep);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      io.disconnect();
      cancels.forEach((c) => c());
    };
  }, [pathname]);

  return null;
}

/**
 * A number that counts up when it appears. The full text is in the page for
 * search engines and screen readers; the moving copy is hidden from them.
 */
export function CountUp({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      <span aria-hidden="true" data-count="">
        {text}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
