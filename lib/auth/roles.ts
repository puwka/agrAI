export type AppRole = "ADMIN" | "USER";

export const ADMIN_ROLE: AppRole = "ADMIN";
export const USER_ROLE: AppRole = "USER";

export function isAdminRole(role?: string | null): role is AppRole {
  return role === ADMIN_ROLE;
}
