import { DashboardHomePage } from "../../features/dashboard/pages/dashboard-home";
import { getSessionUser } from "../../lib/auth/session";

export default async function DashboardRoute() {
  const user = await getSessionUser();

  return (
    <DashboardHomePage
      userName={user?.name ?? "User"}
      isAdmin={user?.role === "ADMIN"}
    />
  );
}
