import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isInternalStudentEmail, loginState, loginsAllowedFor, parseStudentLogins, studentInternalEmail, studentUsername, temporaryPassword } from "./student-logins";

describe("student login settings", () => {
  it("are off unless a school turns them on, and only for chosen classes", () => {
    expect(parseStudentLogins(undefined)).toEqual({ enabled: false, classIds: [] });
    expect(parseStudentLogins({ enabled: "yes", classIds: "jss1" })).toEqual({ enabled: false, classIds: [] });
    const s = parseStudentLogins({ enabled: true, classIds: ["jss1", "jss1", 7, "ss1"] });
    expect(s).toEqual({ enabled: true, classIds: ["jss1", "ss1"] });
    expect(loginsAllowedFor(s, "jss1")).toBe(true);
    expect(loginsAllowedFor(s, "pry5")).toBe(false);
    expect(loginsAllowedFor(s, null)).toBe(false);
    expect(loginsAllowedFor({ enabled: false, classIds: ["jss1"] }, "jss1")).toBe(false);
  });
});

describe("student usernames", () => {
  it("are the school's short name and the admission number, lower case", () => {
    expect(studentUsername("Greenfield-Academy", " GA/2026/0013 ")).toBe("greenfield-academy:ga/2026/0013");
  });
  it("give students an internal address that can never receive email", () => {
    const e = studentInternalEmail("ckabc123");
    expect(e).toBe("student-ckabc123@students.educore.invalid");
    expect(isInternalStudentEmail(e)).toBe(true);
    expect(isInternalStudentEmail("parent@example.com")).toBe(false);
  });
});

describe("one-time passwords", () => {
  it("are 10 readable characters in groups, from crypto randomness", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = temporaryPassword((n) => randomBytes(n));
      expect(p).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{2}$/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
  it("never use look-alike characters (0, o, 1, l, i)", () => {
    const p = temporaryPassword(() => new Uint8Array(16).map((_, i) => i * 16));
    expect(p).not.toMatch(/[0o1li]/);
  });
});

describe("login state", () => {
  it("tells staff where each student is", () => {
    expect(loginState(null)).toBe("none");
    expect(loginState({ isActive: true, mustChangePassword: true, passwordHash: "x" })).toBe("firstSignIn");
    expect(loginState({ isActive: true, mustChangePassword: false, passwordHash: "x" })).toBe("active");
    expect(loginState({ isActive: false, mustChangePassword: false, passwordHash: "x" })).toBe("disabled");
  });
});
