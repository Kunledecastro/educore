/**
 * File rules for assignments (Phase 5). Pure and unit-tested: which files are
 * allowed, recognised by their first bytes (never by name or the browser's
 * word), safe object keys, and the signed "you may register this upload"
 * tokens that tie an uploaded object to the person who asked for it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export { ALLOWED_TYPES, MAX_FILE_BYTES, MAX_FILES_PER_ASSIGNMENT, MAX_FILES_PER_SUBMISSION, type AllowedType } from "./file-types";
import { ALLOWED_TYPES, type AllowedType } from "./file-types";

export function isAllowedType(t: string): t is AllowedType {
  return Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, t);
}

/** The real type of a file from its first bytes, or null if it isn't one we accept. */
export function sniffType(head: Uint8Array): AllowedType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => head[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf"; // %PDF
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "application/msword"; // OLE (legacy .doc)
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; // zip (.docx)
  return null;
}

/** Does what the browser said match what the bytes are? (A .docx is a zip; that's all we can tell from the start.) */
export function typeMatches(declared: AllowedType, sniffed: AllowedType | null): boolean {
  return sniffed !== null && declared === sniffed;
}

/** A file name safe to show and to use in a download header. */
export function safeFileName(name: string, type: AllowedType): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\- ()]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const ext = ALLOWED_TYPES[type];
  const stem = base.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/^[.\s]+/, "") || "file";
  return `${stem}.${ext}`;
}

/** Object key: always inside the school's own folder. */
export function objectKey(tenantId: string, assignmentId: string, kind: "worksheet" | "submission", random: string, fileName: string): string {
  const slug = fileName.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/-+/g, "-").slice(0, 60);
  return `${tenantId}/${assignmentId}/${kind}/${random}-${slug}`;
}

export interface UploadGrant {
  key: string;
  userId: string;
  assignmentId: string;
  contentType: AllowedType;
  fileName: string;
  expiresAt: number;
}

/** A signed grant: proves the server issued this upload slot to this person for this assignment. */
export function signGrant(g: UploadGrant, secret: string): string {
  const payload = Buffer.from(JSON.stringify(g)).toString("base64url");
  const mac = createHmac("sha256", secret).update(`upload-grant:${payload}`).digest("base64url");
  return `${payload}.${mac}`;
}

export function readGrant(token: string, secret: string, now: number = Date.now()): UploadGrant | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac || token.length > 2000) return null;
  const expected = createHmac("sha256", secret).update(`upload-grant:${payload}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const g = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UploadGrant;
    if (typeof g.expiresAt !== "number" || g.expiresAt < now || !isAllowedType(g.contentType)) return null;
    return g;
  } catch {
    return null;
  }
}
