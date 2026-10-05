import { describe, expect, it, vi } from "vitest";
import { SupabaseObjectStore } from "./object-store";

const env = { SUPABASE_URL: "https://proj.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("Supabase storage client", () => {
  it("is off without the service key", () => {
    expect(new SupabaseObjectStore({ SUPABASE_URL: "x" }).configured()).toBe(false);
    expect(new SupabaseObjectStore(env).configured()).toBe(true);
  });

  it("asks for signed upload links with the key, server-side only", async () => {
    const f = vi.fn().mockResolvedValue(json({ url: "/object/upload/sign/educore-uploads/t1/a/x.pdf?token=abc" }));
    const url = await new SupabaseObjectStore(env, f).createUploadUrl("t1/a/x.pdf");
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/upload/sign/educore-uploads/t1/a/x.pdf?token=abc");
    const [called, init] = f.mock.calls[0]!;
    expect(called).toBe("https://proj.supabase.co/storage/v1/object/upload/sign/educore-uploads/t1/a/x.pdf");
    expect(init.headers.Authorization).toBe("Bearer service-key");
  });

  it("reads only the first bytes and the total size of an upload", async () => {
    const f = vi.fn().mockResolvedValue(new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 206, headers: { "content-range": "bytes 0-3/52000" } }));
    const h = await new SupabaseObjectStore(env, f).inspect("t1/a/x.pdf");
    expect(h).toEqual({ sizeBytes: 52000, head: new Uint8Array([0x25, 0x50, 0x44, 0x46]) });
    expect(f.mock.calls[0]![1].headers.Range).toBe("bytes=0-15");
    const missing = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await new SupabaseObjectStore(env, missing).inspect("nope")).toBeNull();
  });

  it("makes expiring download links that save under the given name", async () => {
    const f = vi.fn().mockResolvedValue(json({ signedURL: "/object/sign/educore-uploads/t1/a/x.pdf?token=t" }));
    const url = await new SupabaseObjectStore(env, f).createDownloadUrl("t1/a/x.pdf", "Ada homework.pdf", 120);
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/sign/educore-uploads/t1/a/x.pdf?token=t&download=Ada%20homework.pdf");
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ expiresIn: 120 });
  });
});
