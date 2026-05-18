import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { db } from "../../../../lib/db";
import { getMaintenanceState } from "../../../../lib/maintenance";

export async function GET() {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [maintenance, banner, homePromo, locks] = await Promise.all([
    getMaintenanceState(),
    db.dashboardBanner.getGlobal(),
    db.dashboardHomePromo.getGlobal(),
    db.modelLock.listMap(),
  ]);

  return NextResponse.json({
    maintenance,
    banner: {
      enabled: Boolean(banner?.enabled),
      message: String(banner?.message ?? ""),
    },
    homePromo: {
      enabled: Boolean(homePromo?.enabled),
      html: String(homePromo?.html ?? ""),
    },
    locks,
  });
}
