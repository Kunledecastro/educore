import { describe, expect, it } from "vitest";
import { objectKey, readGrant, safeFileName, signGrant, sniffType, typeMatches } from "./files";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("file types by their bytes", () => {
  it("recognises PDF, JPEG, PNG, DOC and DOCX", () => {
    expect(sniffType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf");
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffType(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe("application/msword");
    expect(sniffType(bytes(0x50, 0x4b, 0x03, 0x04))).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });
  it("refuses everything else — scripts, HTML, SVG, executables", () => {
    for (const s of ["<svg onload=1>", "<html>", "#!/bin/sh", "MZ\x90\x00"]) expect(sniffType(new TextEncoder().encode(s))).toBeNull();
  });
  it("a file renamed to look like another type is caught", () => {
    expect(typeMatches("application/pdf", sniffType(bytes(0xff, 0xd8, 0xff)))).toBe(false);
    expect(typeMatches("image/jpeg", sniffType(bytes(0xff, 0xd8, 0xff)))).toBe(true);
  });
});

describe("names and keys", () => {
  it("keeps names readable and safe, with the real extension", () => {
    expect(safeFileName("Ada's homework.PDF", "application/pdf")).toBe("Ada_s homework.pdf");
    expect(safeFileName("../../etc/passwd", "image/png")).toBe("passwd.png");
    expect(safeFileName("C:\\Users\\ada\\essay.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("essay.docx");
    expect(safeFileName("photo.exe", "image/jpeg")).toBe("photo.jpg");
  });
  it("puts every object inside the school's folder", () => {
    expect(objectKey("t1", "a1", "submission", "r4nd", "Ada Homework.pdf")).toBe("t1/a1/submission/r4nd-ada-homework.pdf");
  });
});

describe("upload grants", () => {
  const g = { key: "t1/a1/submission/x-f.pdf", userId: "u1", assignmentId: "a1", contentType: "application/pdf" as const, fileName: "f.pdf", expiresAt: 2_000 };
  it("round-trip with the right secret, before expiry", () => {
    expect(readGrant(signGrant(g, "s"), "s", 1_000)).toEqual(g);
  });
  it("are refused when forged, tampered with, or expired", () => {
    const tok = signGrant(g, "s");
    expect(readGrant(tok, "other", 1_000)).toBeNull();
    const [p, m] = tok.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...g, key: "t2/x" })).toString("base64url");
    expect(readGrant(`${tampered}.${m}`, "s", 1_000)).toBeNull();
    expect(readGrant(`${p}.${m}`, "s", 3_000)).toBeNull();
    expect(readGrant("garbage", "s", 1_000)).toBeNull();
  });
});
