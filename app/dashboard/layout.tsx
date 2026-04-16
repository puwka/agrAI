import type { ReactNode } from "react";

import { DashboardShell } from "../../features/dashboard/components/dashboard-shell";
import { RestrictedAccessView } from "../../features/dashboard/components/restricted-access-view";
import { db } from "../../lib/db";
import { requireUser } from "../../lib/auth/session";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const user = await requireUser();
  const userId = user.id;

  const restriction = await db.user.findUnique({
    where: { id: userId },
    select: { restrictedUntil: true, restrictedReason: true },
  });

  const now = new Date();
  const isRestricted =
    user.role !== "ADMIN" &&
    Boolean(restriction?.restrictedUntil && restriction.restrictedUntil.getTime() > now.getTime());

  return (
    <DashboardShell
      user={{
        name: user.name ?? "",
        email: user.email ?? "",
        role: user.role,
      }}
    >
      {isRestricted ? (
        <RestrictedAccessView
          until={restriction?.restrictedUntil ?? null}
          reason={restriction?.restrictedReason ?? null}
        />
      ) : (
        children
      )}
    </DashboardShell>
  );
}
