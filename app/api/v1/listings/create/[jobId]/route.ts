// LOCATION: app/api/v1/listings/create/[jobId]/route.ts
// GET /api/v1/listings/create/{job_id}
// Poll a listing creation job (24h TTL)

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-auth";
import { getDb } from "@/lib/firebase-admin";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const apiKey    = req.headers.get("x-api-key");

  const auth = await validateRequest(apiKey, "listings/create/poll");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const db   = getDb();
  const snap = await db.collection("listingJobs").doc(jobId).get();

  if (!snap.exists) {
    return NextResponse.json(
      {
        error: {
          code:    "JOB_NOT_FOUND",
          status:  404,
          message: `Job '${jobId}' not found. Jobs expire after 24 hours.`,
          hint:    "Verify the job_id from the original create response.",
          docs:    "https://jeterdev.tools/docs#listings",
        },
      },
      { status: 404 }
    );
  }

  const job = snap.data()!;

  // Verify ownership via apiKey
  if (job.apiKey !== apiKey) {
    return NextResponse.json(
      { error: { code: "INVALID_API_KEY", status: 401, message: "This job does not belong to your API key." } },
      { status: 401 }
    );
  }

  // Check TTL
  const expiresAt: Date = job.expiresAt instanceof Date
    ? job.expiresAt
    : job.expiresAt.toDate();

  if (new Date() > expiresAt) {
    return NextResponse.json(
      {
        error: {
          code:    "JOB_NOT_FOUND",
          status:  404,
          message: "Job has expired (24 hour limit).",
        },
      },
      { status: 404 }
    );
  }

  return NextResponse.json(job.response ?? { job_id: jobId, status: job.status });
}