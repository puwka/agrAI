import { NextResponse } from "next/server";

import { getApiSessionUser } from "../../../../lib/auth/api-session";
import { DEFAULT_MAINTENANCE_MESSAGE, getMaintenanceState, setMaintenanceState } from "../../../../lib/maintenance";

const MAX_MESSAGE = 4000;

export async function GET() {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const state = await getMaintenanceState();
  return NextResponse.json(state);
}

export async function PATCH(request: Request) {
  const sessionUser = await getApiSessionUser();

  if (!sessionUser?.id || sessionUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { maintenanceEnabled?: unknown; maintenanceMessage?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  if (typeof body.maintenanceEnabled !== "boolean") {
    return NextResponse.json({ error: "Укажите maintenanceEnabled (boolean)" }, { status: 400 });
  }

  const rawMsg =
    typeof body.maintenanceMessage === "string"
      ? body.maintenanceMessage
      : DEFAULT_MAINTENANCE_MESSAGE;
  const maintenanceMessage = rawMsg.trim().slice(0, MAX_MESSAGE);
  if (!maintenanceMessage) {
    return NextResponse.json({ error: "Текст не может быть пустым" }, { status: 400 });
  }

  await setMaintenanceState({
    maintenanceEnabled: body.maintenanceEnabled,
    maintenanceMessage,
  });

  const state = await getMaintenanceState();
  return NextResponse.json(state);
}
