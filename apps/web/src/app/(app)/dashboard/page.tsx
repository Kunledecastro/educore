import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/guard";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const { user, db } = await requireUser();
  const t = await getTranslations("dashboard");

  let stats: { label: string; value: string | number }[] = [];

  switch (user.role) {
    case Role.PLATFORM_ADMIN: {
      const [tenantCount, activeSubs] = await Promise.all([
        db.tenant.count(),
        db.subscription.count({ where: { status: "ACTIVE" } }),
      ]);
      stats = [
        { label: "Schools on platform", value: tenantCount },
        { label: "Active subscriptions", value: activeSubs },
      ];
      break;
    }
    case Role.SCHOOL_ADMIN: {
      const [studentCount, presentToday, feeAgg] = await Promise.all([
        db.student.count({ where: { status: "ACTIVE" } }),
        db.attendance.count({
          where: { date: new Date(new Date().toISOString().slice(0, 10)), status: "PRESENT" },
        }),
        db.payment.aggregate({ _sum: { amount: true } }),
      ]);
      stats = [
        { label: t("enrollment"), value: studentCount },
        { label: t("attendanceToday"), value: presentToday },
        { label: t("feeCollection"), value: `₦${(feeAgg._sum.amount ?? 0).toLocaleString()}` },
      ];
      break;
    }
    case Role.ACCOUNTANT: {
      const [outstanding, collected] = await Promise.all([
        db.invoice.aggregate({ _sum: { totalDue: true }, where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } } }),
        db.payment.aggregate({ _sum: { amount: true } }),
      ]);
      stats = [
        { label: "Outstanding fees", value: `₦${(outstanding._sum.totalDue ?? 0).toLocaleString()}` },
        { label: t("feeCollection"), value: `₦${(collected._sum.amount ?? 0).toLocaleString()}` },
      ];
      break;
    }
    case Role.TEACHER: {
      const teacher = await db.teacher.findUnique({ where: { userId: user.id } });
      const today = new Date().getDay();
      const classesToday = teacher
        ? await db.timetableEntry.count({ where: { teacherId: teacher.id, dayOfWeek: today } })
        : 0;
      stats = [
        { label: t("todaysClasses"), value: classesToday },
        { label: t("pendingAttendance"), value: 0 },
        { label: t("unreadMessages"), value: 0 },
      ];
      break;
    }
    case Role.PARENT: {
      const guardian = await db.guardian.findUnique({
        where: { userId: user.id },
        include: { students: { include: { student: true } } },
      });
      const childCount = guardian?.students.length ?? 0;
      const studentIds = guardian?.students.map((s) => s.studentId) ?? [];
      const feesDue = studentIds.length
        ? await db.invoice.aggregate({ _sum: { totalDue: true }, where: { studentId: { in: studentIds } } })
        : { _sum: { totalDue: null } };
      stats = [
        { label: t("childrenOverview"), value: childCount },
        { label: t("feesDue"), value: `₦${(feesDue._sum.totalDue ?? 0).toLocaleString()}` },
      ];
      break;
    }
    case Role.STUDENT: {
      const student = await db.student.findUnique({ where: { userId: user.id } });
      const resultsCount = student ? await db.mark.count({ where: { studentId: student.id } }) : 0;
      stats = [{ label: t("results"), value: resultsCount }];
      break;
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("welcome", { name: user.name })}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} />
        ))}
      </div>
    </div>
  );
}
