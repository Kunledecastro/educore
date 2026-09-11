import { getCurrentTenant } from "@/lib/tenant";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const tenant = await getCurrentTenant();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {tenant ? tenant.name : "EduCore"}
          </p>
          <h1 className="mt-1 text-xl font-semibold">Sign in to your school portal</h1>
        </div>
        <LoginForm subdomain={tenant?.subdomain} />
      </div>
    </div>
  );
}
