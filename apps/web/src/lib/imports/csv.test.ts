import { describe, expect, it } from "vitest";
import { decodeCsvBytes, matchHeaders, neutralizeFormula, normalizeHeader, parseCsv, parseDayFirstDate, toCsv } from "./csv";

describe("decodeCsvBytes", () => {
  it("reads UTF-8 and strips the BOM Excel adds", () => {
    const bytes = new TextEncoder().encode("﻿name\nAdéwálé");
    expect(decodeCsvBytes(bytes)).toBe("name\nAdéwálé");
  });
  it("falls back to Windows-1252 for files saved by older Excel", () => {
    const bytes = new Uint8Array([0x6e, 0x0a, 0x41, 0x64, 0xe9]); // "n\nAdé" in Windows-1252
    expect(decodeCsvBytes(bytes)).toBe("n\nAdé");
  });
});

describe("parseCsv", () => {
  it("handles quotes, commas in fields, CRLF, and skips blank lines with correct row numbers", () => {
    const { headers, rows } = parseCsv('first_name,last_name\r\n"Okafor, Jr",Ada\r\n\r\nTunde,"Balogun"\r\n');
    expect(headers).toEqual(["first_name", "last_name"]);
    expect(rows).toEqual([
      { line: 2, cells: ["Okafor, Jr", "Ada"] },
      { line: 4, cells: ["Tunde", "Balogun"] },
    ]);
  });
  it("detects semicolon-separated files (European Excel)", () => {
    expect(parseCsv("a;b\n1;2").rows[0]!.cells).toEqual(["1", "2"]);
  });
  it("returns nothing for an empty file", () => {
    expect(parseCsv("\n\n")).toEqual({ headers: [], rows: [] });
  });
});

describe("headers", () => {
  const cols = [
    { key: "admissionNo", header: "admission_no", aliases: ["admission number"], required: true, example: "" },
    { key: "firstName", header: "first_name", required: true, example: "" },
    { key: "section", header: "section", required: false, example: "" },
  ];
  it("matches regardless of case, spaces and punctuation, including aliases", () => {
    expect(normalizeHeader(" Admission No. ")).toBe("admissionno");
    const m = matchHeaders(["Admission Number", "First Name", "Notes"], cols);
    expect(m.indexOf).toEqual({ admissionNo: 0, firstName: 1 });
    expect(m.unknownHeaders).toEqual(["Notes"]);
    expect(m.missingRequired).toEqual([]);
  });
  it("reports missing required and duplicate columns", () => {
    const m = matchHeaders(["first_name", "First Name"], cols);
    expect(m.missingRequired).toEqual(["admission_no"]);
    expect(m.duplicateHeaders).toEqual(["First Name"]);
  });
});

describe("parseDayFirstDate", () => {
  it("reads ISO and day-first dates", () => {
    expect(parseDayFirstDate("2016-03-07")).toBe("2016-03-07");
    expect(parseDayFirstDate("07/03/2016")).toBe("2016-03-07");
    expect(parseDayFirstDate("7-3-2016")).toBe("2016-03-07");
    expect(parseDayFirstDate("7.3.2016")).toBe("2016-03-07");
  });
  it("rejects impossible or ambiguous-looking junk", () => {
    for (const bad of ["31/02/2016", "2016/03/07", "03/07/16", "tomorrow", "13/13/2016", "01/01/1800"]) {
      expect(parseDayFirstDate(bad), bad).toBeNull();
    }
  });
});

describe("exports", () => {
  it("neutralises spreadsheet formulas in exported cells", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2", "@SUM(A1)"]) expect(neutralizeFormula(evil).startsWith("'")).toBe(true);
    expect(neutralizeFormula("Adaeze")).toBe("Adaeze");
  });
  it("writes valid CSV with a BOM, quoting where needed", () => {
    const csv = toCsv(["name", "note"], [["Okafor, Ada", 'said "hi"'], ["=cmd", null]]);
    expect(csv).toBe('﻿name,note\r\n"Okafor, Ada","said ""hi"""\r\n\'=cmd,\r\n');
  });
});
