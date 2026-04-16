import { db } from "./db";

export const DEFAULT_MAINTENANCE_MESSAGE =
  "Ведутся технические работы. Генерация временно недоступна.";

const GLOBAL_ID = "global";

export async function getMaintenanceState() {
  try {
    const row = await db.appSettings.findUnique({ where: { id: GLOBAL_ID } });
    const message = (row?.maintenanceMessage ?? DEFAULT_MAINTENANCE_MESSAGE).trim();
    return {
      enabled: Boolean(row?.maintenanceEnabled),
      message: message || DEFAULT_MAINTENANCE_MESSAGE,
    };
  } catch {
    return { enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE };
  }
}

export async function setMaintenanceState(input: {
  maintenanceEnabled: boolean;
  maintenanceMessage: string;
}) {
  const msg = input.maintenanceMessage.trim() || DEFAULT_MAINTENANCE_MESSAGE;
  await db.appSettings.upsert({
    where: { id: GLOBAL_ID },
    create: {
      id: GLOBAL_ID,
      maintenanceEnabled: input.maintenanceEnabled,
      maintenanceMessage: msg,
    },
    update: {
      maintenanceEnabled: input.maintenanceEnabled,
      maintenanceMessage: msg,
    },
  });
}
