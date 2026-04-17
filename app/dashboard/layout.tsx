import type { ReactNode } from "react";

import { DashboardShell } from "../../features/dashboard/components/dashboard-shell";
import { RestrictedAccessView } from "../../features/dashboard/components/restricted-access-view";
import { SubscriptionExpiredView } from "../../features/dashboard/components/subscription-expired-view";
import { db } from "../../lib/db";
import { requireUser } from "../../lib/auth/session";
import { hasActiveSubscription } from "../../lib/subscription";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const user = await requireUser();
  const userId = user.id;

  const restriction = await db.user.findUnique({
    where: { id: userId },
    select: { restrictedUntil: true, restrictedReason: true, subscriptionUntil: true },
  });

  const now = new Date();
  const isRestricted =
    user.role !== "ADMIN" &&
    Boolean(restriction?.restrictedUntil && restriction.restrictedUntil.getTime() > now.getTime());

  const subscriptionOk = hasActiveSubscription(user.role, restriction?.subscriptionUntil ?? null);
  const subscriptionExpired = user.role !== "ADMIN" && !isRestricted && !subscriptionOk;

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
      ) : subscriptionExpired ? (
        <SubscriptionExpiredView until={restriction?.subscriptionUntil ?? null} />
      ) : (
        children
      )}
    </DashboardShell>
  );
}
