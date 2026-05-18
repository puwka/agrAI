/** Список генераций на дашборде: слияние без «мигания» при гонках poll и неполных ответах API. */

export type GenerationListItem = {
  id: string;
  status: string;
  createdAt: string;
  resultUrl?: string | null;
  resultMessage?: string | null;
};

const ACTIVE_STATUSES = new Set(["PENDING", "QUEUED", "PROCESSING"]);
const TERMINAL_STATUSES = new Set(["SUCCESS", "ERROR"]);

const STATUS_RANK: Record<string, number> = {
  PENDING: 10,
  QUEUED: 20,
  PROCESSING: 30,
  ERROR: 40,
  SUCCESS: 50,
};

const SESSION_STORAGE_KEY = "agrai:dashboard:generations:v1";
const DEFAULT_PRESERVE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ITEMS = 30;

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

function completenessScore(item: GenerationListItem): number {
  let score = STATUS_RANK[item.status] ?? 0;
  if (item.resultUrl?.trim()) score += 100;
  if (item.resultMessage?.trim()) score += 50;
  if (TERMINAL_STATUSES.has(item.status)) score += 25;
  return score;
}

/** Для одного id оставляем запись с более полным результатом (не откатываем SUCCESS → PROCESSING). */
export function pickBetterGeneration<T extends GenerationListItem>(a: T, b: T): T {
  const sa = completenessScore(a);
  const sb = completenessScore(b);
  if (sa !== sb) return sa > sb ? a : b;
  const ta = Date.parse(a.createdAt || "");
  const tb = Date.parse(b.createdAt || "");
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
    return ta > tb ? a : b;
  }
  return a;
}

export function sortGenerationsNewestFirst<T extends GenerationListItem>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}

export type MergeGenerationListsOptions = {
  preserveMs?: number;
  maxItems?: number;
  /** id, которые нельзя убрать из списка (текущая заявка и недавно созданные). */
  pinIds?: string[];
};

/**
 * Объединяет предыдущий список с ответом API:
 * - не теряет недавние записи, если их нет в incoming;
 * - не откатывает статус/результат назад;
 * - закрепляет pinIds.
 */
export function mergeGenerationLists<T extends GenerationListItem>(
  previous: T[],
  incoming: T[],
  opts?: MergeGenerationListsOptions,
): T[] {
  const preserveMs = opts?.preserveMs ?? DEFAULT_PRESERVE_MS;
  const maxItems = opts?.maxItems ?? DEFAULT_MAX_ITEMS;
  const pinSet = new Set((opts?.pinIds ?? []).filter(Boolean));
  const now = Date.now();
  const byId = new Map<string, T>();

  for (const item of incoming) {
    if (!item?.id) continue;
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? pickBetterGeneration(existing, item) : item);
  }

  for (const item of previous) {
    if (!item?.id) continue;
    const existing = byId.get(item.id);
    if (existing) {
      byId.set(item.id, pickBetterGeneration(existing, item));
      continue;
    }
    const created = Date.parse(item.createdAt);
    const recent = Number.isFinite(created) && now - created <= preserveMs;
    const pinned = pinSet.has(item.id);
    const active = isActiveGenerationStatus(item.status);
    if (!recent && !pinned && !active) continue;
    byId.set(item.id, item);
  }

  for (const id of pinSet) {
    const prevItem = previous.find((row) => row.id === id);
    if (!prevItem) continue;
    const existing = byId.get(id);
    byId.set(id, existing ? pickBetterGeneration(existing, prevItem) : prevItem);
  }

  return sortGenerationsNewestFirst(Array.from(byId.values())).slice(0, maxItems);
}

export type ApplyGenerationListUpdateOptions = MergeGenerationListsOptions & {
  /** Не заменять список пустым ответом (сбой/лаг БД). */
  rejectEmptyIncoming?: boolean;
};

export function applyGenerationListUpdate<T extends GenerationListItem>(
  previous: T[],
  incoming: T[],
  opts?: ApplyGenerationListUpdateOptions,
): T[] {
  if (opts?.rejectEmptyIncoming !== false && incoming.length === 0 && previous.length > 0) {
    return previous;
  }

  const merged = mergeGenerationLists(previous, incoming, opts);

  // Подозрительное «сжатие» за один poll — повторно удерживаем весь недавний previous.
  if (
    incoming.length > 0 &&
    previous.length >= 3 &&
    merged.length < previous.length - 1 &&
    merged.length < incoming.length + 2
  ) {
    return mergeGenerationLists(previous, merged, {
      ...opts,
      preserveMs: Math.max(opts?.preserveMs ?? DEFAULT_PRESERVE_MS, DEFAULT_PRESERVE_MS),
    });
  }

  return merged;
}

export function readPersistedGenerations<T extends GenerationListItem>(): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { savedAt?: number; items?: T[] };
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    if (!savedAt || Date.now() - savedAt > DEFAULT_PRESERVE_MS) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return [];
    }
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export function writePersistedGenerations<T extends GenerationListItem>(items: T[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), items: items.slice(0, DEFAULT_MAX_ITEMS) }),
    );
  } catch {
    // ignore quota / private mode
  }
}
