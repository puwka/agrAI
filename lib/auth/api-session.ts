import { cookies } from "next/headers";

import { parseSessionToken, sessionCookieName } from "../simple-session";

export async function getApiSessionUser() {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  return parseSessionToken(token);
}
