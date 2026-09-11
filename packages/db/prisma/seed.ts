/* eslint-disable no-console */
import { PrismaClient, Role, AttendanceStatus } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Passw0rd!23"; // documented in README — demo data only, never used in prod

async function hash(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
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

  const assessmentType = await prisma.assessmentType.create({
    data: { tenantId: tenant.id, name: "Midterm", weight: 0.4 },
  });
  const assessment = await prisma.assessment.create({
    data: {
      tenantId: tenant.id,
      academicYearId: academicYear.id,
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
    data: { tenantId: tenant.id, name: "Tuition", description: "Termly tuition fee" },
  });
  const feeStructure = await prisma.feeStructure.create({
    data: {
      tenantId: tenant.id,
      academicYearId: academicYear.id,
      feeTypeId: feeType.id,
      amount: 150000,
      frequency: "TERMLY",
    },
  });

  const firstNames = ["Amaka", "Tunde", "Chiamaka", "Bayo", "Ijeoma", "Kelechi", "Zainab", "Emeka", "Fatima", "Obinna", "Adaobi", "Yusuf"];
  const lastNames = ["Okonkwo", "Balogun", "Nwosu", "Adigun", "Eze", "Yakubu", "Umeh", "Afolabi", "Chukwu", "Danjuma", "Nnamdi", "Sani"];

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

      await prisma.mark.create({
        data: {
          tenantId: tenant.id,
          assessmentId: assessment.id,
          studentId: student.id,
          score: 60 + ((i * 7) % 40),
          grade: "B",
          enteredById: teachers[0]!.userId,
        },
      });
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
