import { db } from "./db";

export const DEFAULT_DASHBOARD_BANNER_MESSAGE = "";

export async function getDashboardBannerState() {
  try {
    const row = await db.dashboardBanner.getGlobal();
    return {
      enabled: Boolean(row?.enabled),
      message: (row?.message ?? DEFAULT_DASHBOARD_BANNER_MESSAGE).trim(),
    };
  } catch {
    return { enabled: false, message: DEFAULT_DASHBOARD_BANNER_MESSAGE };
  }
}
