import type { ReactNode } from "react";

import { DashboardShell } from "../../features/dashboard/components/dashboard-shell";
import { RestrictedAccessView } from "../../features/dashboard/components/restricted-access-view";
import { SubscriptionExpiredView } from "../../features/dashboard/components/subscription-expired-view";
import { db } from "../../lib/db";
import { requireUser } from "../../lib/auth/session";
import { getDashboardBannerState } from "../../lib/dashboard-banner";
import { hasActiveSubscription, subscriptionSummaryForUser } from "../../lib/subscription";

type FreshUser = { name?: string | null; email?: string | null; role?: string | null } | null;
type RestrictionInfo = {
  restrictedUntil?: Date | null;
  restrictedReason?: string | null;
  subscriptionUntil?: Date | null;
} | null;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return new Promise<T>((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      console.error(`[dashboard/layout] timeout: ${label} (${ms}ms)`);
      resolve(fallback);
    }, ms);
    void promise
      .then((value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        console.error(`[dashboard/layout] failed: ${label}`, error);
        resolve(fallback);
      });
  });
}

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const user = await requireUser();
  const userId = user.id;

  const [freshUser, restriction, dashboardBanner] = await Promise.all([
    withTimeout<FreshUser>(
      db.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, role: true },
      }),
      2500,
      null,
      "db.user.findUnique(freshUser)",
    ),
    withTimeout<RestrictionInfo>(
      db.user.findUnique({
        where: { id: userId },
        select: { restrictedUntil: true, restrictedReason: true, subscriptionUntil: true },
      }),
      2500,
      null,
      "db.user.findUnique(restriction)",
    ),
    withTimeout(getDashboardBannerState(), 1500, { enabled: false, message: "" }, "getDashboardBannerState"),
  ]);

  const now = new Date();
  const isRestricted =
    user.role !== "ADMIN" &&
    Boolean(restriction?.restrictedUntil && restriction.restrictedUntil.getTime() > now.getTime());

  const subscriptionOk = hasActiveSubscription(user.role, restriction?.subscriptionUntil ?? null);
  const subscriptionExpired = user.role !== "ADMIN" && !isRestricted && !subscriptionOk;
  const subscriptionSummary = subscriptionSummaryForUser(user.role, restriction?.subscriptionUntil ?? null);
  return (
    <DashboardShell
      user={{
        name: freshUser?.name?.trim() || user.name || user.email.split("@")[0] || "Пользователь",
        email: freshUser?.email?.trim() || user.email || "",
        role: (freshUser?.role as "ADMIN" | "USER" | undefined) ?? user.role,
        subscriptionSummary,
      }}
      dashboardBanner={dashboardBanner}
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
