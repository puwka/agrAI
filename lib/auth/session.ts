import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { isAdminRole } from "./roles";
import { parseSessionToken, sessionCookieName } from "../simple-session";

export async function getSessionUser() {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  return parseSessionToken(token);
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
