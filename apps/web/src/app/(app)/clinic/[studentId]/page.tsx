import { HealthRecordPage } from "@/components/health/record-page";

export const dynamic = "force-dynamic";

/** The clinic's view of one pupil's health record (Phase 7.0). */
export default function ClinicRecordPage({ params }: { params: { studentId: string } }) {
  return <HealthRecordPage studentId={params.studentId} backHref="/clinic" />;
}
