/** Администраторы не зависят от подписки. Обычному пользователю нужна дата окончания в будущем. */
export function hasActiveSubscription(role: string | undefined, subscriptionUntil: Date | null | undefined) {
  if (role === "ADMIN") return true;
  if (!subscriptionUntil) return false;
  const t = subscriptionUntil.getTime();
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

const MS_DAY = 86_400_000;

/** Краткая строка для UI (сайдбар, профиль). Для ADMIN — null. */
export function subscriptionSummaryForUser(
  role: string | undefined,
  subscriptionUntil: Date | null | undefined,
): string | null {
  if (role === "ADMIN") return null;
  if (!subscriptionUntil) return "Подписка не оформлена";
  const end = subscriptionUntil.getTime();
  if (Number.isNaN(end)) return "Подписка не оформлена";
  const now = Date.now();
  if (end <= now) return "Подписка истекла";
  const daysLeft = Math.ceil((end - now) / MS_DAY);
  const dateStr = subscriptionUntil.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const mod10 = daysLeft % 10;
  const mod100 = daysLeft % 100;
  let daysRu: string;
  if (mod100 >= 11 && mod100 <= 14) {
    daysRu = `${daysLeft} дней`;
  } else if (mod10 === 1) {
    daysRu = `${daysLeft} день`;
  } else if (mod10 >= 2 && mod10 <= 4) {
    daysRu = `${daysLeft} дня`;
  } else {
    daysRu = `${daysLeft} дней`;
  }
  return `Подписка до ${dateStr} · ${daysRu}`;
}
