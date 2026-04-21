import { NextResponse } from "next/server";

import { db } from "../../../../lib/db";
import { getApiSessionUser } from "../../../../lib/auth/api-session";

export async function PATCH(request: Request) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { voiceId?: string; hidden?: boolean };
  try {
    body = (await request.json()) as { voiceId?: string; hidden?: boolean };
  } catch {
    return NextResponse.json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ JSON" }, { status: 400 });
  }

  const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  if (!voiceId) {
    return NextResponse.json({ error: "РЈРєР°Р¶РёС‚Рµ voiceId" }, { status: 400 });
  }
  const hidden = Boolean(body.hidden);

  try {
    await db.voiceHidden.setHidden(voiceId, hidden);
    return NextResponse.json({ voiceId, hidden });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ РІРёРґРёРјРѕСЃС‚СЊ (${msg}). Р’С‹РїРѕР»РЅРёС‚Рµ SQL: sql/add_voice_hidden.sql` },
      { status: 503 },
    );
  }
}
