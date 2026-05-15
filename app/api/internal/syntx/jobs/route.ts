import { NextResponse } from "next/server";

import {
  isSyntxGeneration,
  mapSyntxJob,
  requireAutomationWorker,
  serializeSyntxJob,
} from "../../../../../lib/automation-worker";
import { db } from "../../../../../lib/db";
import { withTransientDbRetry } from "../../../../../lib/transient-db-retry";

const SYNTX_JOB_SELECT = {
  id: true,
  userId: true,
  modelId: true,
  modelName: true,
  prompt: true,
  aspectRatio: true,
  inputMode: true,
  referenceImageUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const CLAIM_CANDIDATE_TAKE = Math.max(
  10,
  Math.min(100, Number.parseInt(process.env.SYNTX_CLAIM_CANDIDATE_TAKE ?? "40", 10) || 40),
);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "unknown error");
}

async function claimNextSyntxJob() {
  const candidates = await db.generation.findMany({
    where: {
      status: { in: ["PENDING", "QUEUED"] },
    },
    orderBy: { createdAt: "asc" },
    take: CLAIM_CANDIDATE_TAKE,
    select: SYNTX_JOB_SELECT,
  });

  for (const candidate of candidates) {
    if (!isSyntxGeneration(candidate)) continue;

    const claimed = await db.generation.updateWhere({
      where: {
        id: candidate.id,
        status: { in: ["PENDING", "QUEUED"] },
      },
      data: {
        status: "PROCESSING",
        errorMessage: null,
      },
    });

    const row = claimed[0];
    if (row) {
      return serializeSyntxJob(mapSyntxJob(row));
    }
  }

  return null;
}

export async function POST(request: Request) {
  const forbidden = requireAutomationWorker(request);
  if (forbidden) return forbidden;

  try {
    const job = await withTransientDbRetry(
      "syntx/claim",
      () => claimNextSyntxJob(),
      { envVar: "SYNTX_CLAIM_DB_RETRIES", fallbackAttempts: 5 },
    );
    return NextResponse.json({ job });
  } catch (error) {
    const message = errorMessage(error);
    console.error("[syntx/jobs] claim failed:", message, error);
    return NextResponse.json(
      {
        job: null,
        error: message,
        retryable: true,
      },
      {
        status: 503,
        headers: { "Retry-After": "2" },
      },
    );
  }
}
