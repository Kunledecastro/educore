import * as React from "react";
import { cn } from "@educore/ui/utils";
import { linePaths, niceScale, percent, plot } from "@/lib/charts";

/**
 * Small SVG charts (Phase 9). No chart library: a few hundred bytes of
 * markup each, readable on a phone, and every chart carries a text label
 * for screen readers (the visual is aria-hidden detail).
 */

/** A trend line with a soft fill, e.g. weekly attendance. Values in order; labels under the points. */
export function LineChart({
  values,
  labels,
  label,
  formatTick = (n) => String(n),
  height = 180,
  className,
}: {
  values: number[];
  labels: string[];
  /** What the chart says, in words (read by screen readers). */
  label: string;
  formatTick?: (n: number) => string;
  height?: number;
  className?: string;
}) {
  const W = 480;
  const PLOT_H = height - 28;
  const LEFT = 44;
  const gid = React.useId().replace(/:/g, "");
  if (values.length === 0) return null;
  const scale = niceScale(Math.min(...values), Math.max(...values), 3);
  const pts = plot(values, W - LEFT - 12, PLOT_H - 10, scale, 8).map((p) => ({ x: p.x + LEFT, y: p.y + 6 }));
  const { line, area } = linePaths(pts, PLOT_H);
  const yOf = (v: number) => 6 + (PLOT_H - 10) - ((v - scale.min) / (scale.max - scale.min || 1)) * (PLOT_H - 10);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${height}`} className={cn("block h-auto w-full text-primary", className)}>
      <defs>
        <linearGradient id={`lf${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g aria-hidden="true">
        {scale.ticks.map((tk) => (
          <g key={tk}>
            <line x1={LEFT} x2={W - 4} y1={yOf(tk)} y2={yOf(tk)} className="stroke-border" strokeWidth="1" />
            <text x={LEFT - 8} y={yOf(tk) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {formatTick(tk)}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#lf${gid})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 5 : 3.5} className="fill-card" stroke="currentColor" strokeWidth="2.5" />
        ))}
        {labels.map((l, i) =>
          pts[i] ? (
            <text key={i} x={pts[i]!.x} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {l}
            </text>
          ) : null,
        )}
      </g>
    </svg>
  );
}

/** Horizontal bars of "done out of total", e.g. fees collected per class. */
export function BarList({
  rows,
  label,
  doneLabel,
  restLabel,
}: {
  rows: { key: string; name: string; done: number; total: number; valueText: string }[];
  label: string;
  doneLabel: string;
  restLabel: string;
}) {
  return (
    <div className="space-y-3">
      <div aria-hidden="true" className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink" />
          {doneLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-warning/40" />
          {restLabel}
        </span>
      </div>
      <ul aria-label={label} className="space-y-2.5">
        {rows.map((r) => {
          const pct = percent(r.done, r.total);
          return (
            <li key={r.key} className="grid grid-cols-[minmax(4rem,7rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate">{r.name}</span>
              <span aria-hidden="true" className="flex h-3 overflow-hidden rounded-full bg-warning/40">
                <span className="bg-ink" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {r.valueText}
                <span className="sr-only"> ({pct}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A thin progress bar. */
export function Progress({ value, total, label, className }: { value: number; total: number; label: string; className?: string }) {
  const pct = percent(value, total);
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className={cn("block h-2 overflow-hidden rounded-full bg-muted", className)}>
      <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** A headline number tile: plain, warm gradient or dark. */
export function StatTile({
  label,
  value,
  detail,
  tone = "plain",
  children,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "plain" | "warm" | "dark";
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-2xl p-5",
        tone === "plain" && "border bg-card",
        tone === "warm" && "bg-harmattan-soft text-foreground",
        tone === "dark" && "bg-ink text-ink-foreground",
      )}
    >
      <span className={cn("text-sm font-semibold", tone === "dark" ? "opacity-80" : "text-muted-foreground", tone === "warm" && "text-foreground/80")}>{label}</span>
      <span className="text-3xl font-extrabold tracking-tight tabular-nums">{value}</span>
      {detail ? <span className={cn("text-sm", tone === "dark" ? "opacity-80" : "text-muted-foreground", tone === "warm" && "text-foreground/80")}>{detail}</span> : null}
      {children}
    </div>
  );
}
