import { redirect } from "next/navigation";

import { getAuthSession } from "../../auth";
import { isAdminRole } from "./roles";

export async function getSessionUser() {
  const session = await getAuthSession();
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireAdmin() {
  const user = await requireUser();

  if (!isAdminRole(user.role)) {
    redirect("/403");
  }

  return user;
}
