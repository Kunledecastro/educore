import { Skeleton } from "@educore/ui/skeleton";

/** Placeholder for a list page while its Server Component loads (use in loading.tsx). */
export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-10 w-full sm:w-72" />
        <Skeleton className="h-10 w-full sm:w-44" />
      </div>
      <div className="rounded-lg border">
        <div className="flex gap-4 border-b p-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 border-b p-4 last:border-0">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
