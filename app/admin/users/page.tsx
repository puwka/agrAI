import { db } from "../../../lib/db";
import { AdminUsersTable, type AdminUserRow } from "../../../features/admin/users/admin-users-table";

export default async function AdminUsersPage() {
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      restrictedUntil: true,
      restrictedReason: true,
      subscriptionUntil: true,
      createdAt: true,
    },
  });

  const rows: AdminUserRow[] = users.map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as "ADMIN" | "USER",
    createdAt: u.createdAt.toISOString(),
    generationsCount: 0,
    apiKeysCount: 0,
    restrictedUntil: u.restrictedUntil ? u.restrictedUntil.toISOString() : null,
    restrictedReason: u.restrictedReason,
    subscriptionUntil: u.subscriptionUntil ? u.subscriptionUntil.toISOString() : null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Пользователи</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Публичная регистрация отключена — новых пользователей добавляйте формой ниже.
        </p>
      </div>

      <AdminUsersTable initialRows={rows} />
    </div>
  );
}
