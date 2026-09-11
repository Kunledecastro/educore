import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getCurrentTenant } from "@/lib/tenant";

export default async function MarketingHome() {
  const tenant = await getCurrentTenant();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
        {tenant ? tenant.name : "EduCore"}
      </span>
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
        Run your entire school on one platform
      </h1>
      <p className="max-w-xl text-muted-foreground">
        Admissions, attendance, grading, timetables, fees, and parent communication — one
        subscription, one dashboard, per school.
      </p>
      <div className="flex gap-3">
        <Button asChild size="lg">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
