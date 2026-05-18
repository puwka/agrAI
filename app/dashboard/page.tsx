import { DashboardHomePage } from "../../features/dashboard/pages/dashboard-home";
import { getDashboardHomePromoState } from "../../lib/dashboard-home-promo";
import { getSessionUser } from "../../lib/auth/session";

export default async function DashboardRoute() {
  const user = await getSessionUser();
  const homePromo = await getDashboardHomePromoState();

  return (
    <DashboardHomePage
      userName={user?.name ?? "User"}
      isAdmin={user?.role === "ADMIN"}
      homePromo={homePromo}
    />
  );
}
