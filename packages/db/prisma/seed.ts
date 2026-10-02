/* eslint-disable no-console */
import { PrismaClient, Role, AttendanceStatus } from "@prisma/client";
import { hash as argon2Hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Passw0rd!23"; // documented in README — demo data only, never used in prod

async function hash(password: string) {
  // Same argon2id parameters as packages/auth/src/passwords.ts.
  return argon2Hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

async function main() {
  console.log("Seeding demo tenant: Greenfield Academy...");

  const passwordHash = await hash(DEMO_PASSWORD);

  // -------------------------------------------------------------------
  // Platform admin (tenantId = null — sits above tenant isolation)
  // -------------------------------------------------------------------
  await prisma.user.upsert({
    where: { email: "platform.admin@educore.dev" },
    update: {},
    create: {
      email: "platform.admin@educore.dev",
      name: "EduCore Platform Admin",
      role: Role.PLATFORM_ADMIN,
      passwordHash,
      isActive: true,
    },
  });

  // -------------------------------------------------------------------
  // Tenant
  // -------------------------------------------------------------------
  const tenant = await prisma.tenant.upsert({
    where: { slug: "greenfield-academy" },
    update: {},
    create: {
      name: "Greenfield Academy",
      slug: "greenfield-academy",
      subdomain: "greenfield",
      plan: "STANDARD",
      status: "ACTIVE",
      settings: { gradingScale: "letter", locale: "en-NG", timezone: "Africa/Lagos" },
      branding: { primaryColor: "#0f766e", logoUrl: null },
    },
  });

  const academicYear = await prisma.academicYear.upsert({
    where: { id: `${tenant.id}-ay-2026-2027` },
    update: {},
    create: {
      id: `${tenant.id}-ay-2026-2027`,
      tenantId: tenant.id,
      name: "2026/2027",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2027-07-31"),
      isActive: true,
    },
  });

  // -------------------------------------------------------------------
  // School admin
  // -------------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: "admin@greenfield.edu" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "admin@greenfield.edu",
      name: "Adaeze Okafor",
      role: Role.SCHOOL_ADMIN,
      passwordHash,
      isActive: true,
    },
  });

  // -------------------------------------------------------------------
  // Classes & sections: Grade 5-A, Grade 6-A
  // -------------------------------------------------------------------
  const grade5 = await prisma.classGrade.create({
    data: { tenantId: tenant.id, academicYearId: academicYear.id, name: "Grade 5", order: 5 },
  });
  const grade6 = await prisma.classGrade.create({
    data: { tenantId: tenant.id, academicYearId: academicYear.id, name: "Grade 6", order: 6 },
  });
  const grade5A = await prisma.section.create({
    data: { tenantId: tenant.id, classId: grade5.id, name: "A", capacity: 30 },
  });
  const grade6A = await prisma.section.create({
    data: { tenantId: tenant.id, classId: grade6.id, name: "A", capacity: 30 },
  });

  // -------------------------------------------------------------------
  // Subjects
  // -------------------------------------------------------------------
  const [math, english, science] = await Promise.all([
    prisma.subject.create({ data: { tenantId: tenant.id, name: "Mathematics", code: "MATH" } }),
    prisma.subject.create({ data: { tenantId: tenant.id, name: "English Language", code: "ENG" } }),
    prisma.subject.create({ data: { tenantId: tenant.id, name: "Basic Science", code: "SCI" } }),
  ]);

  // -------------------------------------------------------------------
  // Teachers (3)
  // -------------------------------------------------------------------
  const teacherSeed = [
    { name: "Chinedu Eze", email: "c.eze@greenfield.edu", employeeId: "GA-T-001" },
    { name: "Funmilayo Bello", email: "f.bello@greenfield.edu", employeeId: "GA-T-002" },
    { name: "Ibrahim Suleiman", email: "i.suleiman@greenfield.edu", employeeId: "GA-T-003" },
  ];
  const teachers = [];
  for (const t of teacherSeed) {
    const user = await prisma.user.upsert({
      where: { email: t.email },
      update: {},
      create: {
        tenantId: tenant.id,
        email: t.email,
        name: t.name,
        role: Role.TEACHER,
        passwordHash,
        isActive: true,
      },
    });
    const teacher = await prisma.teacher.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        employeeId: t.employeeId,
        qualification: "B.Ed",
        department: "Academics",
        joiningDate: new Date("2024-09-01"),
      },
    });
    teachers.push(teacher);
  }

  // Assign each teacher to a section+subject
  await prisma.classSectionSubject.createMany({
    data: [
      { tenantId: tenant.id, sectionId: grade5A.id, subjectId: math.id, teacherId: teachers[0]!.id },
      { tenantId: tenant.id, sectionId: grade5A.id, subjectId: english.id, teacherId: teachers[1]!.id },
      { tenantId: tenant.id, sectionId: grade6A.id, subjectId: science.id, teacherId: teachers[2]!.id },
    ],
  });

  // Form teachers (Phase 2): they take each section's daily register.
  await prisma.section.update({ where: { id: grade5A.id }, data: { formTeacherId: teachers[0]!.id } });
  await prisma.section.update({ where: { id: grade6A.id }, data: { formTeacherId: teachers[2]!.id } });

  // -------------------------------------------------------------------
  // Academic settings (Phase 2, milestone 2.0)
  // -------------------------------------------------------------------
  // Three terms; the first is current.
  await prisma.term.createMany({
    data: [
      { name: "First term", order: 1, startDate: new Date("2026-09-07"), endDate: new Date("2026-12-18"), isCurrent: true },
      { name: "Second term", order: 2, startDate: new Date("2027-01-05"), endDate: new Date("2027-04-09"), isCurrent: false },
      { name: "Third term", order: 3, startDate: new Date("2027-04-26"), endDate: new Date("2027-07-23"), isCurrent: false },
    ].map((t) => ({ ...t, tenantId: tenant.id, academicYearId: academicYear.id })),
  });
  // Grading scale (same as DEFAULT_GRADE_BANDS in apps/web/src/lib/grading.ts).
  await prisma.gradeBand.createMany({
    data: [
      { minScore: 70, grade: "A", remark: "Excellent" },
      { minScore: 60, grade: "B", remark: "Very good" },
      { minScore: 50, grade: "C", remark: "Good" },
      { minScore: 45, grade: "D", remark: "Fair" },
      { minScore: 40, grade: "E", remark: "Pass" },
      { minScore: 0, grade: "F", remark: "Fail" },
    ].map((b) => ({ ...b, tenantId: tenant.id })),
  });
  await prisma.academicSettings.create({ data: { tenantId: tenant.id } });

  // Score components: weights are marks out of 100 and add up to 100.
  const assessmentType = await prisma.assessmentType.create({
    data: { tenantId: tenant.id, name: "Midterm", weight: 40, order: 0 },
  });
  const examType = await prisma.assessmentType.create({ data: { tenantId: tenant.id, name: "Exam", weight: 60, order: 1 } });
  const firstTerm = await prisma.term.findFirstOrThrow({ where: { tenantId: tenant.id, academicYearId: academicYear.id, order: 1 } });
  const assessment = await prisma.assessment.create({
    data: {
      tenantId: tenant.id,
      academicYearId: academicYear.id,
      termId: firstTerm.id,
      sectionId: grade5A.id,
      subjectId: math.id,
      assessmentTypeId: assessmentType.id,
      name: "Mathematics Midterm",
      maxScore: 100,
      date: new Date("2026-11-15"),
    },
  });

  // -------------------------------------------------------------------
  // Parent (1) + Students (12, split 6/6 across the two sections)
  // -------------------------------------------------------------------
  const parentUser = await prisma.user.upsert({
    where: { email: "parent@example.com" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "parent@example.com",
      name: "Ngozi Adeyemi",
      role: Role.PARENT,
      passwordHash,
      isActive: true,
    },
  });
  const guardian = await prisma.guardian.create({
    data: { tenantId: tenant.id, userId: parentUser.id, phone: "+2348012345678" },
  });

  const feeType = await prisma.feeType.create({
    data: { tenantId: tenant.id, name: "Tuition", description: "Termly tuition", order: 1 },
  });
  const feeStructure = await prisma.feeStructure.create({
    data: {
      tenantId: tenant.id,
      academicYearId: academicYear.id,
      termId: firstTerm.id,
      classId: grade5.id,
      feeTypeId: feeType.id,
      amount: 150000,
      frequency: "TERMLY",
    },
  });

  const firstNames = ["Amaka", "Tunde", "Chiamaka", "Bayo", "Ijeoma", "Kelechi", "Zainab", "Emeka", "Fatima", "Obinna", "Adaobi", "Yusuf"];
  const lastNames = ["Okonkwo", "Balogun", "Nwosu", "Adigun", "Eze", "Yakubu", "Umeh", "Afolabi", "Chukwu", "Danjuma", "Nnamdi", "Sani"];

  const seededStudents: { id: string; i: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const section = i < 6 ? grade5A : grade6A;
    const cls = i < 6 ? grade5 : grade6;
    const admissionNo = `GA-2026-${String(i + 1).padStart(4, "0")}`;
    const student = await prisma.student.create({
      data: {
        tenantId: tenant.id,
        admissionNo,
        firstName: firstNames[i]!,
        lastName: lastNames[i]!,
        dateOfBirth: new Date(2015 - (i < 6 ? 0 : 1), i % 12, (i % 27) + 1),
        gender: i % 2 === 0 ? "Female" : "Male",
        classId: cls.id,
        sectionId: section.id,
        academicYearId: academicYear.id,
        admissionDate: new Date("2026-09-01"),
        status: "ACTIVE",
      },
    });

    if (i === 0) {
      // Link the seeded parent to the first student.
      await prisma.studentGuardian.create({
        data: {
          tenantId: tenant.id,
          studentId: student.id,
          guardianId: guardian.id,
          relationship: "MOTHER",
          isPrimary: true,
        },
      });
    }

    if (section.id === grade5A.id) {
      await prisma.attendance.create({
        data: {
          tenantId: tenant.id,
          studentId: student.id,
          sectionId: section.id,
          academicYearId: academicYear.id,
          date: new Date("2026-09-08"),
          status: i % 5 === 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
          markedById: teachers[0]!.userId,
        },
      });

      // Phase 2.1 demo: daily registers for school days 21–29 Sep 2026, taken by the form teacher.
      const formTeacherUserId = (i < 6 ? teachers[0] : teachers[2])!.userId;
      for (const day of ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29"]) {
        const h = (i * 7 + Number(day.slice(-2))) % 20;
        await prisma.attendance.create({
          data: {
            tenantId: tenant.id,
            studentId: student.id,
            classId: cls.id,
            sectionId: section.id,
            academicYearId: academicYear.id,
            date: new Date(day),
            status: h === 0 ? AttendanceStatus.ABSENT : h === 1 ? AttendanceStatus.LATE : h === 2 ? AttendanceStatus.EXCUSED : AttendanceStatus.PRESENT,
            remarks: h === 2 ? "Doctor's appointment" : null,
            markedById: formTeacherUserId,
          },
        });
      }

      seededStudents.push({ id: student.id, i });
      // The Grade 5 A mathematics midterm is marked out of 100 (scaled to 40 marks).
      if (i < 6) {
        await prisma.mark.create({
          data: {
            tenantId: tenant.id,
            assessmentId: assessment.id,
            studentId: student.id,
            score: 60 + ((i * 7) % 40),
            enteredById: teachers[0]!.userId,
          },
        });
      }
    }

    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        studentId: student.id,
        academicYearId: academicYear.id,
        invoiceNo: `INV-${admissionNo}`,
        dueDate: new Date("2026-10-15"),
        status: i === 0 ? "PAID" : "ISSUED",
        subtotal: 150000,
        totalDue: i === 0 ? 0 : 150000,
        currency: "NGN",
        lines: {
          create: [
            {
              tenantId: tenant.id,
              feeStructureId: feeStructure.id,
              description: "Tuition — Term 1",
              amount: 150000,
              quantity: 1,
            },
          ],
        },
      },
    });

    if (i === 0) {
      await prisma.payment.create({
        data: {
          tenantId: tenant.id,
          invoiceId: invoice.id,
          amount: 150000,
          method: "BANK_TRANSFER",
          reference: "SEED-DEMO-0001",
          receiptNo: "RCPT-0001",
        },
      });
    }
  }

  await prisma.announcement.create({
    data: {
      tenantId: tenant.id,
      title: "Welcome back for the 2026/2027 session",
      body: "Classes resume Monday, September 8th. Please ensure fees are settled by the due date.",
      audienceScope: "SCHOOL",
      publishedById: admin.id,
    },
  });


  // -------------------------------------------------------------------
  // Phase 2.2 demo scores (First term; not published — publishing is the demo)
  //   Grade 5 A Mathematics: Exam (the Midterm is above) → complete
  //   Grade 5 A English:     Midterm + Exam → complete
  //   Grade 6 A Science:     Midterm only → Exam still to come
  // -------------------------------------------------------------------
  const column = (sectionId: string, subjectId: string, typeId: string, name: string, maxScore: number) =>
    prisma.assessment.create({
      data: { tenantId: tenant.id, academicYearId: academicYear.id, termId: firstTerm.id, sectionId, subjectId, assessmentTypeId: typeId, name, maxScore, date: new Date("2026-12-10") },
    });
  const mathExam = await column(grade5A.id, math.id, examType.id, "Mathematics · Exam", 60);
  const engMid = await column(grade5A.id, english.id, assessmentType.id, "English · Midterm", 40);
  const engExam = await column(grade5A.id, english.id, examType.id, "English · Exam", 60);
  const sciMid = await column(grade6A.id, science.id, assessmentType.id, "Science · Midterm", 40);
  for (const { id, i } of seededStudents) {
    const scores: [string, number, string][] =
      i < 6
        ? [
            [mathExam.id, 30 + ((i * 11) % 29), teachers[0]!.userId],
            [engMid.id, 20 + ((i * 7) % 19), teachers[1]!.userId],
            [engExam.id, 28 + ((i * 13) % 31), teachers[1]!.userId],
          ]
        : [[sciMid.id, 18 + ((i * 5) % 21), teachers[2]!.userId]];
    for (const [assessmentId, score, enteredById] of scores) {
      await prisma.mark.create({ data: { tenantId: tenant.id, assessmentId, studentId: id, score, enteredById } });
    }
  }


  // Phase 2.3 demo: form teacher comments for four Grade 5 A students (First term). No cards generated.
  const demoComments = [
    "Works hard and takes part well in class discussions.",
    "A careful, steady worker. Should read more at home.",
    "Bright and curious; needs to hand homework in on time.",
    "Has improved steadily this term. Keep it up.",
  ];
  for (const [n, { id }] of seededStudents.filter((x) => x.i < 4).entries()) {
    await prisma.reportCard.create({
      data: { tenantId: tenant.id, studentId: id, academicYearId: academicYear.id, termId: firstTerm.id, teacherComment: demoComments[n]! },
    });
  }

  // Phase 2.4 demo: default bell schedule and a starter week for both sections.
  const bell = [
    ["1", "08:00", "08:40", false], ["2", "08:40", "09:20", false], ["3", "09:20", "10:00", false], ["Break", "10:00", "10:20", true],
    ["4", "10:20", "11:00", false], ["5", "11:00", "11:40", false], ["6", "11:40", "12:20", false], ["Lunch", "12:20", "13:00", true],
    ["7", "13:00", "13:40", false], ["8", "13:40", "14:20", false],
  ] as const;
  await prisma.timetablePeriod.createMany({
    data: bell.map(([label, startTime, endTime, isBreak], i) => ({ tenantId: tenant.id, number: i + 1, label, startTime, endTime, isBreak })),
  });
  const lesson = (section: typeof grade5A, classId: string, subjectId: string, teacherId: string, days: number[], period: number, room: string | null = null) =>
    days.map((dayOfWeek) => ({
      tenantId: tenant.id, classId, sectionId: section.id, subjectId, teacherId, academicYearId: academicYear.id, dayOfWeek, period,
      startTime: bell[period - 1]![1], endTime: bell[period - 1]![2], room,
    }));
  await prisma.timetableEntry.createMany({
    data: [
      ...lesson(grade5A, grade5.id, math.id, teachers[0]!.id, [1, 2, 3, 4, 5], 1),
      ...lesson(grade5A, grade5.id, english.id, teachers[1]!.id, [1, 2, 3, 4, 5], 2),
      ...lesson(grade5A, grade5.id, math.id, teachers[0]!.id, [1, 3, 5], 5),
      ...lesson(grade6A, grade6.id, science.id, teachers[2]!.id, [1, 2, 3, 4, 5], 1, "Science Lab"),
      ...lesson(grade6A, grade6.id, science.id, teachers[2]!.id, [2, 4], 3, "Science Lab"),
    ],
  });
  // Phase 3.0 demo: fee items, a schedule for all three terms, discounts,
  // optional sign-ups, and a bursar (ACCOUNTANT) login.
  await prisma.user.create({
    data: { tenantId: tenant.id, email: "bursar@greenfield.edu", name: "Grace Ade (Bursar)", role: Role.ACCOUNTANT, passwordHash, isActive: true },
  });
  const item = (name: string, description: string, order: number, isOptional = false, isOneOff = false) =>
    prisma.feeType.create({ data: { tenantId: tenant.id, name, description, order, isOptional, isOneOff } });
  const devLevy = await item("Development levy", "Building and facilities", 2);
  const books = await item("Books & materials", "Textbooks and workbooks", 3);
  await item("Admission fee", "New students only", 4, false, true);
  const bus = await item("School bus", "Morning and afternoon routes", 5, true);
  const lunch = await item("Lunch", "Hot lunch, Monday–Friday", 6, true);
  const terms = await prisma.term.findMany({ where: { tenantId: tenant.id, academicYearId: academicYear.id }, orderBy: { order: "asc" } });
  const schedule: { tenantId: string; academicYearId: string; termId: string; classId: string; feeTypeId: string; amount: number }[] = [];
  for (const term of terms) {
    for (const [cls, tuition] of [[grade5, 150000], [grade6, 165000]] as const) {
      const rows: [string, number][] = [[feeType.id, tuition], [devLevy.id, 25000], [bus.id, 30000], [lunch.id, 45000]];
      if (term.order === 1) rows.push([books.id, 18000]);
      for (const [feeTypeId, amount] of rows) {
        if (term.id === firstTerm.id && cls.id === grade5.id && feeTypeId === feeType.id) continue; // created above
        schedule.push({ tenantId: tenant.id, academicYearId: academicYear.id, termId: term.id, classId: cls.id, feeTypeId, amount });
      }
    }
  }
  await prisma.feeStructure.createMany({ data: schedule });
  const sibling = await prisma.discount.create({ data: { tenantId: tenant.id, name: "Sibling discount", kind: "PERCENT", value: 10 } });
  const staffChild = await prisma.discount.create({ data: { tenantId: tenant.id, name: "Staff child", kind: "PERCENT", value: 50, feeTypeId: feeType.id } });
  const merit = await prisma.discount.create({ data: { tenantId: tenant.id, name: "Merit scholarship", kind: "FIXED", value: 75000 } });
  const st = (i: number) => seededStudents.find((x) => x.i === i)!.id;
  await prisma.studentDiscount.createMany({
    data: [
      { tenantId: tenant.id, studentId: st(4), discountId: staffChild.id, academicYearId: academicYear.id, note: "Child of Mr C. Eze (staff)" },
      { tenantId: tenant.id, studentId: st(1), discountId: sibling.id, academicYearId: academicYear.id, note: "Sibling in Grade 6" },
      { tenantId: tenant.id, studentId: st(10), discountId: merit.id, academicYearId: academicYear.id, termId: firstTerm.id, note: "2025/26 top of class" },
    ],
  });
  await prisma.feeSignup.createMany({
    data: [
      [0, bus.id], [2, bus.id], [4, bus.id], [0, lunch.id], [1, lunch.id], [7, bus.id], [9, lunch.id],
    ].map(([i, feeTypeId]) => ({ tenantId: tenant.id, studentId: st(i as number), feeTypeId: feeTypeId as string, termId: firstTerm.id })),
  });

  console.log("Seed complete.");
  console.log(`Tenant subdomain: ${tenant.subdomain}`);
  console.log(`Demo password for all seeded users: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
