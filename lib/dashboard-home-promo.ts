import { sanitizeAdminHtml } from "./sanitize-admin-html";
import { db } from "./db";

export type DashboardHomePromoState = {
  enabled: boolean;
  html: string;
};

export async function getDashboardHomePromoState(): Promise<DashboardHomePromoState> {
  try {
    const row = await db.dashboardHomePromo.getGlobal();
    return {
      enabled: Boolean(row?.enabled),
      html: sanitizeAdminHtml(row?.html ?? ""),
    };
  } catch {
    return { enabled: false, html: "" };
  }
}
