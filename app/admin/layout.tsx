import type { ReactNode } from "react";

import { AdminShell } from "../../features/admin/admin-shell";
import { requireAdmin } from "../../lib/auth/session";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const user = await requireAdmin();

  return (
    <AdminShell
      user={{
        name: user.name ?? "",
        email: user.email ?? "",
        role: user.role,
      }}
    >
      {children}
    </AdminShell>
  );
}
