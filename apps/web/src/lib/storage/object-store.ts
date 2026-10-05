/**
 * Private file storage (Phase 5): Supabase Storage through its REST API, with
 * the service key that never leaves the server. Browsers never get the key —
 * they get one-time signed upload links and short-lived download links.
 * An interface so tests (and, later, R2) can stand in.
 */

export interface StoredObjectHead {
  sizeBytes: number;
  /** The first bytes, to check what the file really is. */
  head: Uint8Array;
}

export interface ObjectStore {
  configured(): boolean;
  /** A one-time URL the browser PUTs the file to (valid ~2 hours, Supabase's default). */
  createUploadUrl(key: string): Promise<string>;
  /** Size and first bytes of an uploaded object, or null if it isn't there. */
  inspect(key: string): Promise<StoredObjectHead | null>;
  /** A short-lived link to download the object under the given name. */
  createDownloadUrl(key: string, downloadName: string, expiresInSeconds?: number): Promise<string>;
  remove(keys: string[]): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "StorageError";
  }
}

const HEAD_BYTES = 16;

export class SupabaseObjectStore implements ObjectStore {
  constructor(private readonly env: Record<string, string | undefined> = process.env, private readonly fetchImpl: typeof fetch = fetch) {}

  private get base() {
    return `${(this.env.SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1`;
  }
  private get bucket() {
    return this.env.STORAGE_BUCKET || "educore-uploads";
  }
  private headers(extra: Record<string, string> = {}) {
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    return { Authorization: `Bearer ${key}`, apikey: key, ...extra };
  }
  private path(key: string) {
    return key.split("/").map(encodeURIComponent).join("/");
  }

  configured(): boolean {
    return Boolean(this.env.SUPABASE_URL && this.env.SUPABASE_SERVICE_ROLE_KEY);
  }

  async createUploadUrl(key: string): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/object/upload/sign/${this.bucket}/${this.path(key)}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: "{}",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { url?: string } | null;
    if (!res.ok || !body?.url) throw new StorageError("Could not create an upload link", res.status);
    return `${this.base}${body.url}`;
  }

  async inspect(key: string): Promise<StoredObjectHead | null> {
    const res = await this.fetchImpl(`${this.base}/object/authenticated/${this.bucket}/${this.path(key)}`, {
      headers: this.headers({ Range: `bytes=0-${HEAD_BYTES - 1}` }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) throw new StorageError("Could not read the uploaded file", res.status);
    const range = res.headers.get("content-range"); // "bytes 0-15/123456"
    const total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length"));
    const head = new Uint8Array(await res.arrayBuffer()).slice(0, HEAD_BYTES);
    return { sizeBytes: Number.isFinite(total) ? total : head.length, head };
  }

  async createDownloadUrl(key: string, downloadName: string, expiresInSeconds = 300): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/object/sign/${this.bucket}/${this.path(key)}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { signedURL?: string } | null;
    if (!res.ok || !body?.signedURL) throw new StorageError("Could not create a download link", res.status);
    const sep = body.signedURL.includes("?") ? "&" : "?";
    return `${this.base}${body.signedURL}${sep}download=${encodeURIComponent(downloadName)}`;
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const res = await this.fetchImpl(`${this.base}/object/${this.bucket}`, {
      method: "DELETE",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: keys }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new StorageError("Could not delete files", res.status);
  }
}

export const objectStore: ObjectStore = new SupabaseObjectStore();

/**
 * Malware-scan hook point (security requirement). Returns true when the file
 * may be kept. Today: type and size checks happen before this; plug a scanner
 * (e.g. ClamAV service) in here when one is available.
 */
export async function scanUpload(_key: string): Promise<boolean> {
  return true;
}
