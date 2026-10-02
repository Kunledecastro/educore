import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS, findClashes, gridOf, lessonsOn, numberPeriods, roomKey, validatePeriods, type LessonRef } from "./timetable";

const p = (startTime: string, endTime: string, isBreak = false, label = "x") => ({ number: 0, label, startTime, endTime, isBreak });
const codes = (i: { code: string }[]) => i.map((x) => x.code);

describe("validatePeriods", () => {
  it("accepts the default bell schedule", () => {
    expect(validatePeriods(DEFAULT_PERIODS.map((d) => ({ ...d, number: 0 })))).toEqual([]);
  });
  it("back-to-back periods are fine; overlaps are not", () => {
    expect(validatePeriods([p("08:00", "08:40"), p("08:40", "09:20")])).toEqual([]);
    expect(validatePeriods([p("08:00", "08:40"), p("08:30", "09:10")])).toEqual([{ code: "overlaps", index: 1 }]);
  });
  it("rejects bad times, end before start, blank labels", () => {
    expect(codes(validatePeriods([p("8:00", "08:40")]))).toContain("badTime");
    expect(codes(validatePeriods([p("24:00", "24:30")]))).toContain("badTime");
    expect(codes(validatePeriods([p("09:00", "08:40")]))).toContain("endBeforeStart");
    expect(codes(validatePeriods([p("08:00", "08:40", false, " ")]))).toContain("blankLabel");
  });
  it("needs at least one teaching period", () => {
    expect(codes(validatePeriods([p("10:00", "10:20", true)]))).toEqual(["noTeaching"]);
    expect(codes(validatePeriods([]))).toEqual(["empty"]);
  });
});

describe("numberPeriods", () => {
  it("numbers periods in time order, whatever order they were entered", () => {
    expect(numberPeriods([p("09:00", "09:40", false, "b"), p("08:00", "08:40", false, "a")]).map((x) => `${x.number}${x.label}`)).toEqual(["1a", "2b"]);
  });
});

describe("findClashes", () => {
  const existing: LessonRef[] = [
    { id: "1", sectionId: "5A", teacherId: "eze", room: "Lab 1", dayOfWeek: 1, period: 2 },
    { id: "2", sectionId: "6A", teacherId: "bello", room: null, dayOfWeek: 1, period: 3 },
  ];
  it("no clash in a free slot", () => {
    expect(findClashes({ sectionId: "6A", teacherId: "eze", room: null, dayOfWeek: 1, period: 4 }, existing)).toEqual([]);
  });
  it("the section already has a lesson then", () => {
    expect(findClashes({ sectionId: "5A", teacherId: "bello", room: null, dayOfWeek: 1, period: 2 }, existing)[0]?.kind).toBe("section");
  });
  it("the teacher is teaching another section then", () => {
    expect(findClashes({ sectionId: "6A", teacherId: "eze", room: null, dayOfWeek: 1, period: 2 }, existing)[0]).toMatchObject({ kind: "teacher", with: { id: "1" } });
  });
  it("the room is in use (case and spacing ignored)", () => {
    expect(findClashes({ sectionId: "6A", teacherId: "suleiman", room: "  lab   1 ", dayOfWeek: 1, period: 2 }, existing)[0]?.kind).toBe("room");
  });
  it("same slot on another day is fine; replacing a lesson ignores itself", () => {
    expect(findClashes({ sectionId: "6A", teacherId: "eze", room: null, dayOfWeek: 2, period: 2 }, existing)).toEqual([]);
    expect(findClashes({ id: "1", sectionId: "5A", teacherId: "eze", room: "Lab 1", dayOfWeek: 1, period: 2 }, existing)).toEqual([]);
  });
});

describe("helpers", () => {
  it("roomKey normalises names; blank is no room", () => {
    expect(roomKey(" Lab   1 ")).toBe("lab 1");
    expect(roomKey("")).toBe("");
    expect(roomKey(null)).toBe("");
  });
  it("gridOf and lessonsOn", () => {
    const l = [{ dayOfWeek: 1, period: 3 }, { dayOfWeek: 1, period: 1 }, { dayOfWeek: 2, period: 1 }];
    expect(gridOf(l).get("1:3")).toHaveLength(1);
    expect(lessonsOn(l, 1).map((x) => x.period)).toEqual([1, 3]);
  });
});
