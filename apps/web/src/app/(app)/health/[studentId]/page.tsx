import { HealthRecordPage } from "@/components/health/record-page";

export const dynamic = "force-dynamic";

/** A parent's view of their own child's health record (Phase 7.0). */
export default function ChildHealthPage({ params }: { params: { studentId: string } }) {
  return <HealthRecordPage studentId={params.studentId} backHref="/health" />;
}
