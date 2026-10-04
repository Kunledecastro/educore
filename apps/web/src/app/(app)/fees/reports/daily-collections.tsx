"use client";

import * as React from "react";

type Day = { date: string; amount: number; label: string };

/**
 * Money in per day, last 30 days: one series, so one hue (the primary
 * token), no legend; bars rise from a shared baseline with 2px gaps and
 * rounded data-ends. Hover/focus shows the day's figure; the same numbers
 * are in a table for screen readers.
 */
export function DailyCollections({ days, locale, caption, dateLabel, amountLabel }: { days: Day[]; locale: string; caption: string; dateLabel: string; amountLabel: string }) {
  const [active, setActive] = React.useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => Math.max(0, d.amount)));
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const shown = active ?? days.length - 1;
  return (
    <figure className="rounded-lg border p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-sm" aria-hidden="true">
        <span className="text-muted-foreground">{fmt.format(new Date(`${days[shown]!.date}T00:00:00Z`))}</span>
        <span className="font-semibold tabular-nums">{days[shown]!.label}</span>
      </div>
      <div className="flex h-36 items-end gap-[2px] border-b border-border" onMouseLeave={() => setActive(null)} aria-hidden="true">
        {days.map((d, i) => (
          <div
            key={d.date}
            className="flex h-full flex-1 cursor-default items-end"
            onMouseEnter={() => setActive(i)}
            title={`${fmt.format(new Date(`${d.date}T00:00:00Z`))}: ${d.label}`}
          >
            <div
              className={`w-full rounded-t-[4px] ${active === i ? "bg-primary" : "bg-primary/70"}`}
              style={{ height: d.amount > 0 ? `${Math.max(2, (d.amount / max) * 100)}%` : "0%" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>{fmt.format(new Date(`${days[0]!.date}T00:00:00Z`))}</span>
        <span>{fmt.format(new Date(`${days[days.length - 1]!.date}T00:00:00Z`))}</span>
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{dateLabel}</th>
            <th scope="col">{amountLabel}</th>
          </tr>
        </thead>
        <tbody>
          {days.filter((d) => d.amount !== 0).map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
