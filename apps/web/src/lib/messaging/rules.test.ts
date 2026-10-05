import { describe, expect, it } from "vitest";
import { announcementVisibleTo, canEditAnnouncement, canMessage, canPostAnnouncement, canReadThread, isUnread, type Viewer } from "./rules";

const a = (over: Partial<Parameters<typeof announcementVisibleTo>[0]> = {}) => ({ audienceScope: "SCHOOL" as const, audienceClassId: null, audienceRole: null, publishedById: "admin", ...over });
const parent: Viewer = { userId: "p1", role: "PARENT", classIds: ["jss1"] };
const teacher: Viewer = { userId: "t1", role: "TEACHER", classIds: ["jss1", "jss2"] };
const student: Viewer = { userId: "s1", role: "STUDENT", classIds: ["jss2"] };
const bursar: Viewer = { userId: "b1", role: "ACCOUNTANT", classIds: [] };
const admin: Viewer = { userId: "admin2", role: "SCHOOL_ADMIN", classIds: [] };

describe("who sees an announcement", () => {
  it("whole-school announcements reach everyone", () => {
    for (const v of [parent, teacher, student, bursar, admin]) expect(announcementVisibleTo(a(), v)).toBe(true);
  });
  it("role announcements reach only that role (and admins)", () => {
    const toParents = a({ audienceScope: "ROLE", audienceRole: "PARENT" });
    expect(announcementVisibleTo(toParents, parent)).toBe(true);
    expect(announcementVisibleTo(toParents, teacher)).toBe(false);
    expect(announcementVisibleTo(toParents, student)).toBe(false);
    expect(announcementVisibleTo(toParents, admin)).toBe(true);
  });
  it("class announcements reach the class's teachers, students and parents only", () => {
    const toJss1 = a({ audienceScope: "CLASS", audienceClassId: "jss1" });
    expect(announcementVisibleTo(toJss1, parent)).toBe(true);
    expect(announcementVisibleTo(toJss1, teacher)).toBe(true);
    expect(announcementVisibleTo(toJss1, student)).toBe(false); // student is in JSS2
    expect(announcementVisibleTo(toJss1, bursar)).toBe(false);
    expect(announcementVisibleTo(a({ audienceScope: "CLASS", audienceClassId: "jss1", publishedById: "b1" }), bursar)).toBe(true); // own post
  });
});

describe("who may post", () => {
  it("admins post anything, including pinned", () => {
    expect(canPostAnnouncement({ role: "SCHOOL_ADMIN", classIds: [] }, { audienceScope: "SCHOOL", audienceClassId: null, isPinned: true })).toBeNull();
  });
  it("teachers post only to classes they teach, never pinned", () => {
    expect(canPostAnnouncement(teacher, { audienceScope: "CLASS", audienceClassId: "jss2", isPinned: false })).toBeNull();
    expect(canPostAnnouncement(teacher, { audienceScope: "CLASS", audienceClassId: "ss3", isPinned: false })).toBe("classNotTaught");
    expect(canPostAnnouncement(teacher, { audienceScope: "SCHOOL", audienceClassId: null, isPinned: false })).toBe("classNotTaught");
    expect(canPostAnnouncement(teacher, { audienceScope: "CLASS", audienceClassId: "jss1", isPinned: true })).toBe("pinAdminOnly");
  });
  it("parents, students and bursars don't post", () => {
    for (const v of [parent, student, bursar]) expect(canPostAnnouncement(v, { audienceScope: "SCHOOL", audienceClassId: null, isPinned: false })).toBe("notAllowed");
  });
  it("teachers edit only their own; admins any", () => {
    expect(canEditAnnouncement(teacher, { publishedById: "t1" })).toBe(true);
    expect(canEditAnnouncement(teacher, { publishedById: "admin" })).toBe(false);
    expect(canEditAnnouncement(admin, { publishedById: "t1" })).toBe(true);
    expect(canEditAnnouncement(parent, { publishedById: "p1" })).toBe(false);
  });
});

describe("messaging", () => {
  it("only admins, teachers and parents message", () => {
    expect(["SCHOOL_ADMIN", "TEACHER", "PARENT"].every((r) => canMessage(r as never))).toBe(true);
    expect(["STUDENT", "ACCOUNTANT", "PLATFORM_ADMIN"].some((r) => canMessage(r as never))).toBe(false);
  });
  it("participants and school admins can read a conversation; nobody else", () => {
    expect(canReadThread(parent, ["p1", "t1"])).toBe(true);
    expect(canReadThread({ userId: "p2", role: "PARENT" }, ["p1", "t1"])).toBe(false);
    expect(canReadThread({ userId: "t9", role: "TEACHER" }, ["p1", "t1"])).toBe(false);
    expect(canReadThread(admin, ["p1", "t1"])).toBe(true);
  });
  it("unread until read after the last message", () => {
    const at = new Date("2026-10-05T10:00:00Z");
    expect(isUnread(at, null)).toBe(true);
    expect(isUnread(at, new Date("2026-10-05T09:59:59Z"))).toBe(true);
    expect(isUnread(at, at)).toBe(false);
  });
});
