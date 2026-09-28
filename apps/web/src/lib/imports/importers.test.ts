import { describe, expect, it } from "vitest";
import { Role } from "@educore/db";
import { validateCsv } from "./engine";
import { classesImporter } from "./importers/classes";
import { staffImporter, type StaffLookup } from "./importers/staff";
import { studentsImporter, type StudentLookup } from "./importers/students";
import { templateFor } from "./registry";

const studentLookup: StudentLookup = {
  academicYearId: "y1",
  classes: new Map([
    ["grade 5", { id: "c5", sections: new Map([["a", "s5a"]]) }],
    ["grade 6", { id: "c6", sections: new Map() }],
  ]),
  userRoles: new Map([
    ["parent@example.com", Role.PARENT],
    ["c.eze@greenfield.edu", Role.TEACHER],
  ]),
};

const H = "admission_no,first_name,last_name,class,section,gender,date_of_birth,guardian_name,guardian_email,guardian_relationship";

describe("student import validation", () => {
  it("accepts good rows, resolving class/section by name (any case) and day-first dates", () => {
    const r = validateCsv(studentsImporter, `${H}\nga-1,Ada,Okafor,GRADE 5,a,F,07/03/2016,,,\nGA-2,Tunde,Bello,Grade 6,,,,,,`, studentLookup);
    expect(r.fatal).toBe(false);
    expect(r.errorRows).toBe(0);
    expect(r.valid.get(2)).toMatchObject({ admissionNo: "GA-1", classId: "c5", sectionId: "s5a", gender: "FEMALE" });
    expect(r.valid.get(2)!.dateOfBirth!.toISOString()).toBe("2016-03-07T00:00:00.000Z");
    expect(r.valid.get(3)).toMatchObject({ classId: "c6", sectionId: null, guardian: null });
  });

  it("reports unknown classes/sections and bad values per cell, with the spreadsheet row number", () => {
    const r = validateCsv(studentsImporter, `${H}\nGA-1,Ada,Okafor,Grade 9,,Female,,,,\nGA-2,Tunde,Bello,Grade 5,Z,Boy,31/02/2016,,,`, studentLookup);
    expect(r.errorRows).toBe(2);
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, column: "class", message: "imports.issues.unknownClass" }),
        expect.objectContaining({ row: 3, column: "section", message: "imports.issues.unknownSection" }),
        expect.objectContaining({ row: 3, column: "gender", message: "imports.issues.badGender" }),
        expect.objectContaining({ row: 3, column: "date_of_birth", message: "imports.issues.badDate" }),
      ]),
    );
  });

  it("flags a repeated admission number in the same file, pointing at the first occurrence", () => {
    const r = validateCsv(studentsImporter, `${H}\nGA-1,Ada,Okafor,Grade 5,,,,,,\nga-1,Ade,Okafor,Grade 5,,,,,,`, studentLookup);
    expect(r.valid.size).toBe(1);
    expect(r.issues).toContainEqual({ row: 3, column: "admission_no", message: "imports.issues.duplicateInFile", params: { row: 2 } });
  });

  it("siblings can share a new parent: only the first row needs the parent's name", () => {
    const csv = `${H}\nGA-1,Ada,Okafor,Grade 5,,,,Ngozi Okafor,ngozi@example.com,Mother\nGA-2,Obi,Okafor,Grade 6,,,,,NGOZI@example.com,mother`;
    const r = validateCsv(studentsImporter, csv, studentLookup);
    expect(r.errorRows).toBe(0);
    expect(r.valid.get(3)!.guardian).toMatchObject({ email: "ngozi@example.com", name: null, relationship: "MOTHER" });
  });

  it("requires the name for a brand-new parent, and refuses emails that belong to staff", () => {
    const csv = `${H}\nGA-1,Ada,Okafor,Grade 5,,,,,new@example.com,\nGA-2,Obi,Okafor,Grade 5,,,,Chinedu,c.eze@greenfield.edu,Father\nGA-3,Ify,Eze,Grade 5,,,,,parent@example.com,`;
    const r = validateCsv(studentsImporter, csv, studentLookup);
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, column: "guardian_name", message: "imports.issues.guardianNameRequired" }),
        expect.objectContaining({ row: 3, column: "guardian_email", message: "imports.issues.emailNotParent" }),
      ]),
    );
    expect(r.valid.has(4)).toBe(true); // existing parent: name not needed
  });

  it("rejects files with missing required columns, no rows, or too many rows as a whole", () => {
    expect(validateCsv(studentsImporter, "first_name,last_name\nAda,Okafor", studentLookup).issues[0]).toMatchObject({
      row: 0,
      message: "imports.issues.missingColumns",
    });
    expect(validateCsv(studentsImporter, H, studentLookup).issues[0]!.message).toBe("imports.issues.emptyFile");
    const huge = `${H}\n` + Array.from({ length: 5001 }, (_, i) => `A-${i},A,B,Grade 5,,,,,,`).join("\n");
    expect(validateCsv(studentsImporter, huge, studentLookup)).toMatchObject({ fatal: true, issues: [{ message: "imports.issues.tooManyRows" }] });
  });

  it("ignores (but mentions) extra columns", () => {
    const r = validateCsv(studentsImporter, "admission_no,first_name,last_name,class,Notes\nGA-1,Ada,Okafor,Grade 5,likes maths", studentLookup);
    expect(r.valid.size).toBe(1);
    expect(r.issues).toContainEqual({ row: 0, column: null, message: "imports.issues.ignoredColumns", params: { columns: "Notes" } });
  });

  it("the downloadable template itself validates (apart from its example class)", () => {
    const { headers, example } = templateFor("STUDENTS");
    const lookup = { ...studentLookup, classes: new Map([["grade 5", { id: "c5", sections: new Map([["a", "s5a"]]) }]]) };
    const r = validateCsv(studentsImporter, `${headers.join(",")}\n${example.join(",")}`, lookup);
    expect(r.issues).toEqual([]);
  });
});

const staffLookup: StaffLookup = {
  userRoles: new Map([
    ["c.eze@greenfield.edu", Role.TEACHER],
    ["bursar@greenfield.edu", Role.ACCOUNTANT],
  ]),
  employeeIds: new Map([["GA-T-001", "c.eze@greenfield.edu"]]),
};
const SH = "name,email,role,employee_id,department";

describe("staff import validation", () => {
  it("accepts teachers, admins and accountants with friendly role names", () => {
    const r = validateCsv(staffImporter, `${SH}\nA,a@x.co,Teacher,t-9,\nB,b@x.co,Administrator,a-1,\nC,c@x.co,bursar,f-1,`, staffLookup);
    expect(r.errorRows).toBe(0);
    expect([...r.valid.values()].map((v) => v.role)).toEqual([Role.TEACHER, Role.SCHOOL_ADMIN, Role.ACCOUNTANT]);
  });

  it("never lets an import change someone's role or steal an employee ID", () => {
    const r = validateCsv(staffImporter, `${SH}\nChinedu,c.eze@greenfield.edu,admin,GA-T-001,\nNew,new@x.co,teacher,GA-T-001,`, staffLookup);
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, column: "role", message: "imports.issues.roleMismatch" }),
        expect.objectContaining({ row: 3, column: "employee_id", message: "imports.issues.employeeIdTaken" }),
      ]),
    );
  });

  it("rejects unknown roles (never platform admin) and duplicate emails in the file", () => {
    const r = validateCsv(staffImporter, `${SH}\nA,a@x.co,platform_admin,x-1,\nB,b@x.co,teacher,x-2,\nB2,B@X.CO,teacher,x-3,`, staffLookup);
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, column: "role", message: "imports.issues.badRole" }),
        expect.objectContaining({ row: 4, column: "email", message: "imports.issues.duplicateInFile" }),
      ]),
    );
  });
});

describe("class import validation", () => {
  const lookup = { academicYearId: "y1" };
  it("accepts class-only and class+section rows and catches repeats", () => {
    const r = validateCsv(classesImporter, "class,section,capacity,order\nJSS 1,A,40,1\nJSS 1,B,,1\nJSS 2,,,2\njss 1,a,,", lookup);
    expect(r.valid.size).toBe(3);
    expect(r.issues).toContainEqual(expect.objectContaining({ row: 5, message: "imports.issues.duplicateInFile" }));
  });
  it("rejects capacity without a section and non-numeric values", () => {
    const r = validateCsv(classesImporter, "class,section,capacity,order\nJSS 1,,40,\nJSS 2,A,lots,x", lookup);
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, column: "capacity", message: "imports.issues.capacityWithoutSection" }),
        expect.objectContaining({ row: 3, column: "capacity" }),
        expect.objectContaining({ row: 3, column: "order" }),
      ]),
    );
  });
});
