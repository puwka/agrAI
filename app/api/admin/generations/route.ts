import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";

export async function GET() {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = await db.generation.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return NextResponse.json(items);
}
