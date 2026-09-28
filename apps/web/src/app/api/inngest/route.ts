import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { FUNCTIONS } from "@/lib/inngest/run-import";

// Inngest calls this endpoint to run each step. Requests are signed; the
// SDK rejects anything not signed with INNGEST_SIGNING_KEY.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({ client: inngest, functions: FUNCTIONS });
