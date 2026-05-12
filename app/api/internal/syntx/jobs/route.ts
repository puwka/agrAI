import { NextResponse } from "next/server";

import { db } from "../../../../../lib/db";
import {
  isSyntxGeneration,
  mapSyntxJob,
  requireAutomationWorker,
} from "../../../../../lib/automation-worker";

export async function POST(request: Request) {
  const forbidden = requireAutomationWorker(request);
  if (forbidden) return forbidden;

  const candidates = await db.generation.findMany({
    where: {
      status: { in: ["PENDING", "QUEUED"] },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
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
      return NextResponse.json({ job: mapSyntxJob(row) });
    }
  }

  return NextResponse.json({ job: null });
}
