import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../lib/auth/api-session";
import { db } from "../../../lib/db";

export async function GET() {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const map = await db.modelLock.listMap();
  return NextResponse.json({
    locks: map,
  });
}
