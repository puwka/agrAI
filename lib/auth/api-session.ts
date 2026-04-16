import { getServerSession } from "next-auth";

import { authOptions } from "../../auth";

export async function getApiSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return null;
  }
  return session.user;
}
