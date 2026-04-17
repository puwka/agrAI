/** Администраторы не зависят от подписки. Обычному пользователю нужна дата окончания в будущем. */
export function hasActiveSubscription(role: string | undefined, subscriptionUntil: Date | null | undefined) {
  if (role === "ADMIN") return true;
  if (!subscriptionUntil) return false;
  const t = subscriptionUntil.getTime();
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}
