import { NextResponse } from "next/server";

import { db } from "../../../../../lib/db";
import { getApiSessionUser } from "../../../../../lib/auth/api-session";

export async function DELETE(_request: Request, context: { params: Promise<{ voiceId: string }> }) {
  const sessionUser = await getApiSessionUser();
  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { voiceId: raw } = await context.params;
  const voiceId = decodeURIComponent(raw ?? "").trim();
  if (!voiceId) {
    return NextResponse.json({ error: "Некорректный voiceId" }, { status: 400 });
  }

  try {
    await db.customVoice.delete(voiceId);
    await db.voicePreviewOverride.deleteByVoiceId(voiceId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
