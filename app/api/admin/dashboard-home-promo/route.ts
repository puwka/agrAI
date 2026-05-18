import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { sanitizeAdminHtml } from "../../../../lib/sanitize-admin-html";
import { db } from "../../../../lib/db";

const MAX_HTML = 50_000;

export async function GET() {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await db.dashboardHomePromo.getGlobal();
  return NextResponse.json({
    enabled: Boolean(row?.enabled),
    html: row?.html ?? "",
  });
}

export async function PATCH(request: Request) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { enabled?: unknown; html?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown; html?: unknown };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Укажите enabled (boolean)" }, { status: 400 });
  }

  const htmlRaw = typeof body.html === "string" ? body.html : "";
  const html = sanitizeAdminHtml(htmlRaw.slice(0, MAX_HTML));

  const saved = await db.dashboardHomePromo.upsertGlobal({ enabled: body.enabled, html });
  if (!saved.ok) {
    return NextResponse.json(
      {
        error:
          "Таблица DashboardHomePromo не создана. Выполните sql/add_dashboard_home_promo.sql в Supabase SQL Editor.",
      },
      { status: 503 },
    );
  }

  const row = await db.dashboardHomePromo.getGlobal();
  return NextResponse.json({
    enabled: Boolean(row?.enabled),
    html: row?.html ?? "",
  });
}
