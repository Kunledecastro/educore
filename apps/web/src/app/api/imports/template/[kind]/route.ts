import { NextResponse } from "next/server";
import { can } from "@educore/auth";
import { toCsv } from "@/lib/imports/csv";
import { IMPORTERS, templateFor } from "@/lib/imports/registry";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

const KIND_BY_SLUG = { students: "STUDENTS", staff: "STAFF", classes: "CLASSES", payments: "PAYMENTS" } as const;

/** GET /api/imports/template/{students|staff|classes} — header row + one example row. */
export async function GET(_req: Request, { params }: { params: { kind: string } }) {
  const kind = KIND_BY_SLUG[params.kind as keyof typeof KIND_BY_SLUG];
  if (!kind) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const ctx = await requireUser();
    const [resource, action] = IMPORTERS[kind].permission;
    if (!can(ctx.user.role, resource, action)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { headers, example } = templateFor(kind);
  return new NextResponse(toCsv(headers, [example]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="educore-${params.kind}-template.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
