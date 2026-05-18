/** Общая логика списка генераций на дашборде — защита от «исчезновения» при гонках poll. */

export type GenerationListItem = {
  id: string;
  status: string;
  createdAt: string;
};

const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "PROCESSING"]);

export function isActiveGenerationStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function parseGenerationsApiPayload<T extends GenerationListItem>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

/** Слияние ответа API с локальным списком: не теряем недавние активные заявки, пока их нет в ответе. */
export function mergeGenerationLists<T extends GenerationListItem>(
  previous: T[],
  incoming: T[],
  opts?: { preserveActiveMs?: number },
): T[] {
  const preserveActiveMs = opts?.preserveActiveMs ?? 5 * 60_000;
  const now = Date.now();
  const byId = new Map<string, T>();

  for (const item of incoming) {
    if (item?.id) byId.set(item.id, item);
  }

  for (const item of previous) {
    if (!item?.id || byId.has(item.id)) continue;
    if (!isActiveGenerationStatus(item.status)) continue;
    const created = Date.parse(item.createdAt);
    if (!Number.isFinite(created) || now - created > preserveActiveMs) continue;
    byId.set(item.id, item);
  }

  return Array.from(byId.values()).sort(
    (a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""),
  );
}

export function sortGenerationsNewestFirst<T extends GenerationListItem>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}
