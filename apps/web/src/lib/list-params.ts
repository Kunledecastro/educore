/**
 * URL-driven list state (search, filters, sort, pagination) for every list
 * page. Lists are Server Components that read `searchParams`, so the URL is
 * the single source of truth: shareable, back-button friendly, no client
 * cache to go stale. This module is pure and fully unit-tested — everything
 * that comes from the URL is untrusted and gets clamped/whitelisted here.
 */

export type SearchParamsInput = Record<string, string | string[] | undefined> | URLSearchParams;

export type SortDir = "asc" | "desc";

export interface ListConfig<S extends string, F extends string> {
  /** Columns the user may sort by. Anything else in `?sort=` is ignored. */
  sortable: readonly S[];
  defaultSort: S;
  defaultDir?: SortDir;
  /** Allowed values per filter key. A value not in the list is ignored. */
  filters?: Record<F, readonly string[]>;
  pageSizes?: readonly number[];
  defaultPageSize?: number;
}

export interface ListParams<S extends string, F extends string> {
  q: string;
  sort: S;
  dir: SortDir;
  page: number;
  pageSize: number;
  filters: Partial<Record<F, string>>;
  /** Ready for Prisma: `skip` and `take`. */
  skip: number;
  take: number;
}

export const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;
export const MAX_SEARCH_LENGTH = 100;

function first(v: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

function get(params: SearchParamsInput, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return first(params[key]);
}

export function parseListParams<S extends string, F extends string = never>(
  params: SearchParamsInput,
  config: ListConfig<S, F>,
): ListParams<S, F> {
  const pageSizes = config.pageSizes ?? DEFAULT_PAGE_SIZES;
  const defaultPageSize = config.defaultPageSize ?? 25;

  const q = (get(params, "q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH);

  const rawSort = get(params, "sort");
  const sort = (config.sortable as readonly string[]).includes(rawSort ?? "") ? (rawSort as S) : config.defaultSort;

  const rawDir = get(params, "dir");
  const dir: SortDir = rawDir === "asc" || rawDir === "desc" ? rawDir : (config.defaultDir ?? "asc");

  const rawSize = Number.parseInt(get(params, "size") ?? "", 10);
  const pageSize = pageSizes.includes(rawSize) ? rawSize : defaultPageSize;

  const rawPage = Number.parseInt(get(params, "page") ?? "", 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, 10_000) : 1;

  const filters: Partial<Record<F, string>> = {};
  if (config.filters) {
    for (const key of Object.keys(config.filters) as F[]) {
      const value = get(params, key);
      if (value && config.filters[key].includes(value)) filters[key] = value;
    }
  }

  return { q, sort, dir, page, pageSize, filters, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Returns a new query string with `patch` applied. `null`/`""` removes a key.
 * Any change other than `page` resets to page 1, so a new search or filter
 * never lands on an empty page 7.
 */
export function buildListQuery(current: URLSearchParams | string, patch: Record<string, string | number | null | undefined>): string {
  const next = new URLSearchParams(typeof current === "string" ? current : current.toString());
  let resetPage = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
    if (key !== "page") resetPage = true;
  }
  if (resetPage) next.delete("page");
  const s = next.toString();
  return s ? `?${s}` : "";
}

/** "Showing 26–50 of 120" numbers, clamped for the last/empty page. */
export function pageRange(page: number, pageSize: number, total: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  return { from, to, pageCount, hasPrev: page > 1, hasNext: page < pageCount };
}
