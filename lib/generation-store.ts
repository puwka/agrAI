/**
 * Заявки на генерацию — только на диске сервера (.runtime/data/generations.json).
 * Клиент и воркер ходят через /api/*; Supabase Postgres для Generation не используется.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

type AnyRecord = Record<string, unknown>;

export type GenerationRow = {
  id: string;
  userId: string;
  modelId: string;
  modelName: string;
  inputMode: string;
  referenceImageUrl: string | null;
  prompt: string;
  aspectRatio: string;
  status: string;
  resultUrl: string | null;
  resultMessage: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoreFile = {
  version: 1;
  generations: Record<string, GenerationRow>;
};

const STORE_DIR = path.join(process.cwd(), ".runtime", "data");
const STORE_PATH = path.join(STORE_DIR, "generations.json");
const TMP_PATH = `${STORE_PATH}.tmp`;

let cache: StoreFile | null = null;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn) as Promise<T>;
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function emptyStore(): StoreFile {
  return { version: 1, generations: {} };
}

async function loadStore(): Promise<StoreFile> {
  if (cache) return cache;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (parsed?.version === 1 && parsed.generations && typeof parsed.generations === "object") {
      cache = parsed;
      return cache;
    }
  } catch {
    // missing or corrupt — start fresh
  }
  cache = emptyStore();
  await persistStore(cache);
  return cache;
}

async function persistStore(store: StoreFile) {
  await mkdir(STORE_DIR, { recursive: true });
  const body = JSON.stringify(store, null, 0);
  await writeFile(TMP_PATH, body, "utf8");
  await rename(TMP_PATH, STORE_PATH);
  cache = store;
}

function normalizeRow(input: AnyRecord): GenerationRow {
  const now = new Date().toISOString();
  return {
    id: String(input.id ?? ""),
    userId: String(input.userId ?? ""),
    modelId: String(input.modelId ?? ""),
    modelName: String(input.modelName ?? ""),
    inputMode: String(input.inputMode ?? "TEXT"),
    referenceImageUrl:
      input.referenceImageUrl == null || input.referenceImageUrl === ""
        ? null
        : String(input.referenceImageUrl),
    prompt: String(input.prompt ?? ""),
    aspectRatio: String(input.aspectRatio ?? "16:9"),
    status: String(input.status ?? "PENDING"),
    resultUrl: input.resultUrl == null || input.resultUrl === "" ? null : String(input.resultUrl),
    resultMessage:
      input.resultMessage == null || input.resultMessage === "" ? null : String(input.resultMessage),
    errorMessage:
      input.errorMessage == null || input.errorMessage === "" ? null : String(input.errorMessage),
    createdAt: String(input.createdAt ?? now),
    updatedAt: String(input.updatedAt ?? now),
  };
}

function matchesWhere(row: GenerationRow, where?: AnyRecord): boolean {
  if (!where) return true;
  for (const [key, raw] of Object.entries(where)) {
    const val = (row as AnyRecord)[key];
    if (raw && typeof raw === "object" && raw !== null && "in" in (raw as AnyRecord)) {
      const list = (raw as { in: unknown }).in;
      if (!Array.isArray(list) || !list.includes(val)) return false;
    } else if (val !== raw) {
      return false;
    }
  }
  return true;
}

function matchesSearch(row: GenerationRow, search?: string): boolean {
  const q = search?.trim().toLowerCase();
  if (!q) return true;
  return (
    row.prompt.toLowerCase().includes(q) || row.modelName.toLowerCase().includes(q)
  );
}

function sortRows(rows: GenerationRow[], orderBy?: AnyRecord): GenerationRow[] {
  const dir = String(orderBy?.createdAt ?? "desc").toLowerCase();
  const asc = dir === "asc";
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
    return asc ? ta - tb : tb - ta;
  });
}

function projectRow(row: GenerationRow, select?: AnyRecord): AnyRecord {
  if (!select) return { ...row };
  const out: AnyRecord = {};
  for (const [k, v] of Object.entries(select)) {
    if (v) out[k] = (row as AnyRecord)[k];
  }
  return out;
}

function duplicateKeyError() {
  const err = new Error("duplicate key value violates unique constraint") as Error & { code?: string };
  err.code = "23505";
  return err;
}

export const generationStore = {
  async findMany(
    args: {
      where?: AnyRecord;
      orderBy?: AnyRecord;
      take?: number;
      skip?: number;
      select?: AnyRecord;
      search?: string;
    } = {},
  ) {
    return enqueue(async () => {
      const store = await loadStore();
      let rows = Object.values(store.generations).filter(
        (row) => matchesWhere(row, args.where) && matchesSearch(row, args.search),
      );
      rows = sortRows(rows, args.orderBy);
      const skip = Math.max(0, args.skip ?? 0);
      const take = args.take ?? 1000;
      rows = rows.slice(skip, skip + take);
      return rows.map((row) => projectRow(row, args.select));
    });
  },

  async countWhere(args: { where?: AnyRecord; search?: string } = {}) {
    return enqueue(async () => {
      const store = await loadStore();
      return Object.values(store.generations).filter(
        (row) => matchesWhere(row, args.where) && matchesSearch(row, args.search),
      ).length;
    });
  },

  async count() {
    return enqueue(async () => {
      const store = await loadStore();
      return Object.keys(store.generations).length;
    });
  },

  async countByUserIds(userIds: string[]) {
    return enqueue(async () => {
      const store = await loadStore();
      const set = new Set(userIds);
      const m = new Map<string, number>();
      for (const id of userIds) m.set(id, 0);
      for (const row of Object.values(store.generations)) {
        if (!set.has(row.userId)) continue;
        m.set(row.userId, (m.get(row.userId) ?? 0) + 1);
      }
      return m;
    });
  },

  async findFirst(args: { where?: AnyRecord; select?: AnyRecord }) {
    const rows = await this.findMany({
      where: args.where,
      select: args.select,
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    return rows[0] ?? null;
  },

  async findUnique(args: { where: AnyRecord }) {
    const [key, val] = Object.entries(args.where)[0] ?? [];
    if (!key) return null;
    return enqueue(async () => {
      const store = await loadStore();
      if (key === "id") {
        const row = store.generations[String(val)];
        return row ? { ...row } : null;
      }
      const found = Object.values(store.generations).find((row) => (row as AnyRecord)[key] === val);
      return found ? { ...found } : null;
    });
  },

  async create(args: { data: AnyRecord }) {
    return enqueue(async () => {
      const store = await loadStore();
      const d = { ...args.data } as AnyRecord;
      const userConnect = d.user as AnyRecord | undefined;
      if (userConnect?.connect && (userConnect.connect as AnyRecord).id) {
        d.userId = (userConnect.connect as AnyRecord).id;
      }
      delete d.user;
      const id = String(d.id ?? crypto.randomUUID());
      if (store.generations[id]) {
        throw duplicateKeyError();
      }
      const now = new Date().toISOString();
      const row = normalizeRow({ ...d, id, createdAt: now, updatedAt: now });
      store.generations[id] = row;
      await persistStore(store);
      return { ...row };
    });
  },

  async update(args: { where: AnyRecord; data: AnyRecord }) {
    return enqueue(async () => {
      const store = await loadStore();
      const [key, val] = Object.entries(args.where)[0] ?? [];
      const id = key === "id" ? String(val) : "";
      const row = id ? store.generations[id] : undefined;
      if (!row) throw new Error("Generation not found");
      const updated = normalizeRow({
        ...row,
        ...args.data,
        id: row.id,
        userId: row.userId,
        createdAt: row.createdAt,
        updatedAt: new Date().toISOString(),
      });
      store.generations[row.id] = updated;
      await persistStore(store);
      return { ...updated };
    });
  },

  async updateWhere(args: { where: AnyRecord; data: AnyRecord }) {
    return enqueue(async () => {
      const store = await loadStore();
      const matches = Object.values(store.generations).filter((row) => matchesWhere(row, args.where));
      const target = matches[0];
      if (!target) return [];
      const updated = normalizeRow({
        ...target,
        ...args.data,
        id: target.id,
        userId: target.userId,
        createdAt: target.createdAt,
        updatedAt: new Date().toISOString(),
      });
      store.generations[target.id] = updated;
      await persistStore(store);
      return [{ ...updated }];
    });
  },

  async delete(args: { where: AnyRecord }) {
    return enqueue(async () => {
      const store = await loadStore();
      const [key, val] = Object.entries(args.where)[0] ?? [];
      const id = key === "id" ? String(val) : "";
      if (!id || !store.generations[id]) {
        return { id: val };
      }
      delete store.generations[id];
      await persistStore(store);
      return { id };
    });
  },

  async deleteOlderThanForUser(userId: string, cutoffIso: string) {
    return enqueue(async () => {
      const store = await loadStore();
      const cutoff = Date.parse(cutoffIso);
      let deleted = 0;
      for (const [id, row] of Object.entries(store.generations)) {
        if (row.userId !== userId) continue;
        if (Date.parse(row.createdAt) < cutoff) {
          delete store.generations[id];
          deleted += 1;
        }
      }
      if (deleted > 0) await persistStore(store);
      return { deleted };
    });
  },

  async deleteOlderThanFinishedForUser(userId: string, cutoffIso: string) {
    return enqueue(async () => {
      const store = await loadStore();
      const cutoff = Date.parse(cutoffIso);
      let deleted = 0;
      for (const [id, row] of Object.entries(store.generations)) {
        if (row.userId !== userId) continue;
        if (row.status !== "SUCCESS" && row.status !== "ERROR") continue;
        if (Date.parse(row.createdAt) < cutoff) {
          delete store.generations[id];
          deleted += 1;
        }
      }
      if (deleted > 0) await persistStore(store);
      return { deleted };
    });
  },

  async deleteManyByUserId(userId: string) {
    return enqueue(async () => {
      const store = await loadStore();
      let deleted = 0;
      for (const [id, row] of Object.entries(store.generations)) {
        if (row.userId !== userId) continue;
        delete store.generations[id];
        deleted += 1;
      }
      if (deleted > 0) await persistStore(store);
      return { deleted };
    });
  },
};
