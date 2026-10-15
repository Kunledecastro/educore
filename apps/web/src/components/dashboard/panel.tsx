import Link from "next/link";
import { cn } from "@educore/ui/utils";

/** A dashboard section: a white card with a title, an optional link, and content (Phase 9.1). */
export function Panel({ title, href, linkLabel, children, className }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode; className?: string }) {
  const id = `p-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-base font-bold">
          {title}
        </h2>
        {href && linkLabel ? (
          <Link href={href} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** One row of a dashboard list: main text, a second line, and something on the right. */
export function Row({ title, detail, right }: { title: React.ReactNode; detail?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-t py-2.5 first:border-t-0 first:pt-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      {right}
    </li>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
