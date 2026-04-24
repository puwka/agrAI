import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AnyRecord = any;

const globalForSupabase = globalThis as unknown as {
  supabaseAdmin: SupabaseClient | undefined;
};

const SUPABASE_FETCH_TIMEOUT_MS = 15000;
const SUPABASE_FETCH_RETRIES = 2;

function isTransientNetworkError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return (
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("terminated") ||
    msg.includes("fetch failed") ||
    msg.includes("aborted")
  );
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function supabaseFetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= SUPABASE_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("SUPABASE_TIMEOUT")), SUPABASE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(input, {
        ...init,
        signal: init?.signal ?? controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < SUPABASE_FETCH_RETRIES && isTransientNetworkError(error)) {
        await delay(200 * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Supabase fetch failed"));
}

function getSupabaseAdmin() {
  if (!globalForSupabase.supabaseAdmin) {
    const url = process.env.SUPABASE_URL ?? "";
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!url) throw new Error("SUPABASE_URL is not set");
    if (!serviceRole) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    globalForSupabase.supabaseAdmin = createClient(url, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: supabaseFetchWithRetry },
    });
  }
  return globalForSupabase.supabaseAdmin;
}

function nowIso() {
  return new Date().toISOString();
}

function hydrateRecord(row: AnyRecord) {
  const out: AnyRecord = { ...row };
  for (const key of [
    "createdAt",
    "updatedAt",
    "lastUsedAt",
    "restrictedUntil",
    "subscriptionUntil",
  ]) {
    if (typeof out[key] === "string") out[key] = new Date(out[key]);
  }
  return out;
}

function hydrateRows(rows: AnyRecord[]) {
  return rows.map((r) => hydrateRecord(r));
}

function project(row: AnyRecord, select?: AnyRecord, extra?: AnyRecord) {
  if (!select) return row;
  const out: AnyRecord = {};
  for (const [k, v] of Object.entries(select)) {
    if (!v) continue;
    if (k === "_count" && extra?._count) {
      out._count = extra._count;
      continue;
    }
    out[k] = row[k];
  }
  return out;
}

function columnsFromSelect(select?: AnyRecord, extras: string[] = []) {
  if (!select) return "*";
  const keys = Object.entries(select)
    .filter(([k, v]) => Boolean(v) && k !== "_count")
    .map(([k]) => k);
  const all = [...keys, ...extras];
  const unique = [...new Set(all.filter(Boolean))];
  return unique.length > 0 ? unique.join(",") : "*";
}

function applyWhere(query: any, where?: AnyRecord) {
  if (!where) return query;
  let q = query;
  for (const [k, raw] of Object.entries(where)) {
    if (raw && typeof raw === "object" && "in" in (raw as AnyRecord)) {
      q = q.in(k, (raw as AnyRecord).in);
    } else {
      q = q.eq(k, raw);
    }
  }
  return q;
}

/** Подстрока для or(prompt.ilike…,modelName.ilike…) — экранируем % _ \ и запятые в OR-строке PostgREST */
function generationSearchOrPattern(search: string) {
  const escaped = search
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, " ");
  return `%${escaped}%`;
}

function applyGenerationSearchOr(query: any, search?: string) {
  const s = search?.trim();
  if (!s) return query;
  const pat = generationSearchOrPattern(s);
  return query.or(`prompt.ilike.${pat},modelName.ilike.${pat}`);
}

async function userCounts(ids: string[]) {
  const m = new Map<string, { generations: number; apiKeys: number }>();
  for (const id of ids) m.set(id, { generations: 0, apiKeys: 0 });
  if (ids.length === 0) return m;

  const supabase = getSupabaseAdmin();
  const { data: genRows } = await supabase
    .from("Generation")
    .select("userId")
    .in("userId", ids);
  if (genRows) {
    for (const row of genRows as Array<{ userId: string }>) {
      const curr = m.get(row.userId) ?? { generations: 0, apiKeys: 0 };
      curr.generations += 1;
      m.set(row.userId, curr);
    }
  }

  const { data: keyRows } = await supabase
    .from("ApiKey")
    .select("userId")
    .in("userId", ids);
  if (keyRows) {
    for (const row of keyRows as Array<{ userId: string }>) {
      const curr = m.get(row.userId) ?? { generations: 0, apiKeys: 0 };
      curr.apiKeys += 1;
      m.set(row.userId, curr);
    }
  }

  return m;
}

async function withUserInclude(rows: AnyRecord[], include?: AnyRecord) {
  if (!include?.user || rows.length === 0) return rows;
  const select = (include.user as AnyRecord).select as AnyRecord | undefined;
  const ids = [...new Set(rows.map((r) => String(r.userId)).filter(Boolean))];
  if (ids.length === 0) return rows;
  const { data, error } = await getSupabaseAdmin().from("User").select("*").in("id", ids);
  if (error) throw error;
  const users = hydrateRows((data ?? []) as AnyRecord[]);
  const byId = new Map(users.map((u) => [String(u.id), select ? project(u, select) : u]));
  return rows.map((r) => ({ ...r, user: byId.get(String(r.userId)) ?? null }));
}

export const db: any = {
  user: {
    async findUnique(args: { where: AnyRecord; select?: AnyRecord }) {
      const [key, val] = Object.entries(args.where)[0] ?? [];
      if (!key) return null;
      const { data, error } = await getSupabaseAdmin().from("User").select("*").eq(key, val).limit(1);
      if (error) throw error;
      const row = data?.[0] ? hydrateRecord(data[0] as AnyRecord) : null;
      if (!row) return null;
      if (args.select?._count) {
        const counts = await userCounts([String(row.id)]);
        return project(row, args.select, { _count: counts.get(String(row.id)) ?? { generations: 0, apiKeys: 0 } });
      }
      return project(row, args.select);
    },
    async findMany(args: { orderBy?: AnyRecord; take?: number; select?: AnyRecord } = {}) {
      const dir = String((args.orderBy?.createdAt as string) ?? "desc").toUpperCase() === "ASC" ? "ASC" : "DESC";
      const take = args.take ?? 1000;
      const { data, error } = await getSupabaseAdmin()
        .from("User")
        .select("*")
        .order("createdAt", { ascending: dir === "ASC" })
        .limit(take);
      if (error) throw error;
      const rows = hydrateRows((data ?? []) as AnyRecord[]);
      if (args.select?._count) {
        const counts = await userCounts(rows.map((r) => String(r.id)));
        return rows.map((r) => project(r, args.select, { _count: counts.get(String(r.id)) ?? { generations: 0, apiKeys: 0 } }));
      }
      return rows.map((r) => project(r, args.select));
    },
    async count() {
      const { count, error } = await getSupabaseAdmin().from("User").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    async create(args: { data: AnyRecord; select?: AnyRecord }) {
      const data = {
        ...args.data,
        id: (args.data.id as string | undefined) ?? crypto.randomUUID(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const { data: rows, error } = await getSupabaseAdmin().from("User").insert(data).select("*").limit(1);
      if (error) throw error;
      const row = rows?.[0] ? hydrateRecord(rows[0] as AnyRecord) : null;
      if (!row) throw new Error("User insert failed");
      if (args.select?._count) {
        return project(row, args.select, { _count: { generations: 0, apiKeys: 0 } });
      }
      return project(row, args.select);
    },
    async update(args: { where: AnyRecord; data: AnyRecord; select?: AnyRecord }) {
      const [key, val] = Object.entries(args.where)[0] ?? [];
      const data = { ...args.data, updatedAt: nowIso() };
      const { data: rows, error } = await getSupabaseAdmin()
        .from("User")
        .update(data)
        .eq(key, val)
        .select("*")
        .limit(1);
      if (error) throw error;
      const row = rows?.[0] ? hydrateRecord(rows[0] as AnyRecord) : null;
      if (!row) throw new Error("User not found");
      if (args.select?._count) {
        const counts = await userCounts([String(row.id)]);
        return project(row, args.select, { _count: counts.get(String(row.id)) ?? { generations: 0, apiKeys: 0 } });
      }
      return project(row, args.select);
    },
  },
  appSettings: {
    async findUnique(args: { where: AnyRecord }) {
      const [key, val] = Object.entries(args.where)[0] ?? [];
      const { data, error } = await getSupabaseAdmin().from("AppSettings").select("*").eq(key, val).limit(1);
      if (error) throw error;
      return data?.[0] ? hydrateRecord(data[0] as AnyRecord) : null;
    },
    async upsert(args: { where: AnyRecord; create: AnyRecord; update: AnyRecord }) {
      const id = String(args.where.id);
      const data = { ...args.create, ...args.update, id, updatedAt: nowIso() };
      const { data: rows, error } = await getSupabaseAdmin()
        .from("AppSettings")
        .upsert(data, { onConflict: "id" })
        .select("*")
        .limit(1);
      if (error) throw error;
      if (!rows?.[0]) throw new Error("AppSettings upsert failed");
      return hydrateRecord(rows[0] as AnyRecord);
    },
  },
  dashboardBanner: {
    async getGlobal(): Promise<{ enabled: boolean; message: string } | null> {
      try {
        const { data, error } = await getSupabaseAdmin()
          .from("DashboardBanner")
          .select("enabled, message")
          .eq("id", "global")
          .limit(1);
        if (error) return null;
        const row = (data?.[0] ?? null) as { enabled?: boolean; message?: string } | null;
        if (!row) return null;
        return {
          enabled: Boolean(row.enabled),
          message: String(row.message ?? "").trim(),
        };
      } catch {
        return null;
      }
    },
    async upsertGlobal(input: { enabled: boolean; message: string }) {
      const message = input.message.trim();
      const { error } = await getSupabaseAdmin().from("DashboardBanner").upsert(
        { id: "global", enabled: input.enabled, message, updatedAt: nowIso() },
        { onConflict: "id" },
      );
      if (error) throw error;
    },
  },
  modelLock: {
    async listMap(): Promise<Record<string, { enabled: boolean; message: string }>> {
      try {
        const { data, error } = await getSupabaseAdmin().from("ModelLock").select("modelId, enabled, message");
        if (error) return {};
        const map: Record<string, { enabled: boolean; message: string }> = {};
        for (const row of (data ?? []) as Array<{ modelId?: string; enabled?: boolean; message?: string }>) {
          const modelId = String(row.modelId ?? "").trim();
          if (!modelId) continue;
          map[modelId] = {
            enabled: Boolean(row.enabled),
            message: String(row.message ?? "").trim(),
          };
        }
        return map;
      } catch {
        return {};
      }
    },
    async setLocked(modelId: string, enabled: boolean, message: string) {
      const id = modelId.trim();
      if (!id) throw new Error("modelId обязателен");
      if (!enabled) {
        const { error } = await getSupabaseAdmin().from("ModelLock").delete().eq("modelId", id);
        if (error) throw error;
        return;
      }
      const { error } = await getSupabaseAdmin().from("ModelLock").upsert(
        { modelId: id, enabled: true, message: message.trim(), updatedAt: nowIso() },
        { onConflict: "modelId" },
      );
      if (error) throw error;
    },
  },
  generation: {
    async findMany(
      args: {
        where?: AnyRecord;
        orderBy?: AnyRecord;
        take?: number;
        skip?: number;
        include?: AnyRecord;
        select?: AnyRecord;
        search?: string;
      } = {},
    ) {
      const dir = String((args.orderBy?.createdAt as string) ?? "desc").toUpperCase() === "ASC" ? "ASC" : "DESC";
      const take = args.take ?? 1000;
      const skip = Math.max(0, args.skip ?? 0);
      const needUserIdForInclude = Boolean(args.include?.user);
      const columns = columnsFromSelect(args.select, needUserIdForInclude ? ["userId"] : []);
      let q = getSupabaseAdmin().from("Generation").select(columns);
      q = applyWhere(q, args.where);
      q = applyGenerationSearchOr(q, args.search);
      q = q.order("createdAt", { ascending: dir === "ASC" });
      const end = skip + take - 1;
      const { data, error } = await q.range(skip, end);
      if (error) throw error;
      const rows = hydrateRows((data ?? []) as AnyRecord[]);
      const withIncluded = await withUserInclude(rows, args.include);
      if (args.select) {
        return withIncluded.map((r) => project(r, args.select));
      }
      return withIncluded;
    },
    async countWhere(args: { where?: AnyRecord; search?: string } = {}) {
      let q = getSupabaseAdmin().from("Generation").select("*", { count: "exact", head: true });
      q = applyWhere(q, args.where);
      q = applyGenerationSearchOr(q, args.search);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
    async findFirst(args: { where?: AnyRecord; select?: AnyRecord }) {
      let q = getSupabaseAdmin().from("Generation").select("*");
      q = applyWhere(q, args.where);
      const { data, error } = await q.order("createdAt", { ascending: false }).limit(1);
      if (error) throw error;
      const rows = hydrateRows((data ?? []) as AnyRecord[]);
      const row = rows[0];
      return row ? project(row, args.select) : null;
    },
    async findUnique(args: { where: AnyRecord }) {
      const [key, val] = Object.entries(args.where)[0] ?? [];
      const { data, error } = await getSupabaseAdmin().from("Generation").select("*").eq(key, val).limit(1);
      if (error) throw error;
      return data?.[0] ? hydrateRecord(data[0] as AnyRecord) : null;
    },
    async create(args: { data: AnyRecord }) {
      const d = { ...args.data } as AnyRecord;
      const userConnect = d.user as AnyRecord | undefined;
      if (userConnect?.connect && (userConnect.connect as AnyRecord).id) {
        d.userId = (userConnect.connect as AnyRecord).id;
      }
      delete d.user;
      const data = {
        ...d,
        id: (d.id as string | undefined) ?? crypto.randomUUID(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const { data: rows, error } = await getSupabaseAdmin().from("Generation").insert(data).select("*").limit(1);
      if (error) throw error;
      if (!rows?.[0]) throw new Error("Generation insert failed");
      return hydrateRecord(rows[0] as AnyRecord);
    },
    async update(args: { where: AnyRecord; data: AnyRecord }) {
      const [key, val] = Object.entries(args.where)[0] ?? [];
      const data = { ...args.data, updatedAt: nowIso() };
      const { data: rows, error } = await getSupabaseAdmin()
        .from("Generation")
        .update(data)
        .eq(key, val)
        .select("*")
        .limit(1);
      if (error) throw error;
      if (!rows[0]) throw new Error("Generation not found");
      return hydrateRecord(rows[0] as AnyRecord);
    },
    async delete(args: { where: AnyRecord }) {
      const [key, val] = Object.entries(args.where)[0] ?? [];
      const { error } = await getSupabaseAdmin().from("Generation").delete().eq(key, val);
      if (error) throw error;
      return { id: val };
    },
    async count() {
      const { count, error } = await getSupabaseAdmin().from("Generation").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  },
  apiKey: {
    async findMany(args: { where?: AnyRecord; orderBy?: AnyRecord; take?: number } = {}) {
      const dir = String((args.orderBy?.createdAt as string) ?? "desc").toUpperCase() === "ASC" ? "ASC" : "DESC";
      const take = args.take ?? 1000;
      let q = getSupabaseAdmin().from("ApiKey").select("*");
      q = applyWhere(q, args.where);
      const { data, error } = await q.order("createdAt", { ascending: dir === "ASC" }).limit(take);
      if (error) throw error;
      return hydrateRows((data ?? []) as AnyRecord[]);
    },
    async findFirst(args: { where?: AnyRecord }) {
      let q = getSupabaseAdmin().from("ApiKey").select("*");
      q = applyWhere(q, args.where);
      const { data, error } = await q.order("createdAt", { ascending: false }).limit(1);
      if (error) throw error;
      return data?.[0] ? hydrateRecord(data[0] as AnyRecord) : null;
    },
    async create(args: { data: AnyRecord }) {
      const data = {
        ...args.data,
        id: (args.data.id as string | undefined) ?? crypto.randomUUID(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const { data: rows, error } = await getSupabaseAdmin().from("ApiKey").insert(data).select("*").limit(1);
      if (error) throw error;
      if (!rows?.[0]) throw new Error("ApiKey insert failed");
      return hydrateRecord(rows[0] as AnyRecord);
    },
    async update(args: { where: AnyRecord; data: AnyRecord }) {
      const [key, val] = Object.entries(args.where)[0] ?? [];
      const data = { ...args.data, updatedAt: nowIso() };
      const { data: rows, error } = await getSupabaseAdmin()
        .from("ApiKey")
        .update(data)
        .eq(key, val)
        .select("*")
        .limit(1);
      if (error) throw error;
      if (!rows[0]) throw new Error("ApiKey not found");
      return hydrateRecord(rows[0] as AnyRecord);
    },
    async delete(args: { where: AnyRecord }) {
      const [key, val] = Object.entries(args.where)[0] ?? [];
      const { error } = await getSupabaseAdmin().from("ApiKey").delete().eq(key, val);
      if (error) throw error;
      return { id: val };
    },
  },
  voicePreviewOverride: {
    async listMap(): Promise<Record<string, string>> {
      try {
        const { data, error } = await getSupabaseAdmin()
          .from("VoicePreviewOverride")
          .select("voiceId, previewUrl");
        if (error) return {};
        const map: Record<string, string> = {};
        for (const row of (data ?? []) as Array<{ voiceId?: string; previewUrl?: string }>) {
          const id = row.voiceId?.trim();
          const url = row.previewUrl?.trim();
          if (id && url) map[id] = url;
        }
        return map;
      } catch {
        return {};
      }
    },
    async upsert(voiceId: string, previewUrl: string) {
      const id = voiceId.trim();
      const url = previewUrl.trim();
      if (!id || !url) throw new Error("voiceId и previewUrl обязательны");
      const { error } = await getSupabaseAdmin().from("VoicePreviewOverride").upsert(
        { voiceId: id, previewUrl: url, updatedAt: nowIso() },
        { onConflict: "voiceId" },
      );
      if (error) throw error;
    },
    async deleteByVoiceId(voiceId: string) {
      const id = voiceId.trim();
      if (!id) return;
      try {
        await getSupabaseAdmin().from("VoicePreviewOverride").delete().eq("voiceId", id);
      } catch {
        // ignore
      }
    },
  },
  voiceHidden: {
    async listSet(): Promise<Set<string>> {
      try {
        const { data, error } = await getSupabaseAdmin().from("VoiceHidden").select("voiceId, hidden");
        if (error) return new Set();
        const out = new Set<string>();
        for (const row of (data ?? []) as Array<{ voiceId?: string; hidden?: boolean }>) {
          const id = row.voiceId?.trim();
          if (id && row.hidden !== false) out.add(id);
        }
        return out;
      } catch {
        return new Set();
      }
    },
    async setHidden(voiceId: string, hidden: boolean) {
      const id = voiceId.trim();
      if (!id) throw new Error("voiceId обязателен");
      if (!hidden) {
        const { error } = await getSupabaseAdmin().from("VoiceHidden").delete().eq("voiceId", id);
        if (error) throw error;
        return;
      }
      const { error } = await getSupabaseAdmin().from("VoiceHidden").upsert(
        { voiceId: id, hidden: true, updatedAt: nowIso() },
        { onConflict: "voiceId" },
      );
      if (error) throw error;
    },
  },
  customVoice: {
    async list(): Promise<
      Array<{
        voiceId: string;
        name: string;
        gender: string;
        locale: string;
        previewUrl: string;
        tagsJson: string;
        createdAt?: string;
      }>
    > {
      try {
        const { data, error } = await getSupabaseAdmin()
          .from("CustomVoice")
          .select("*")
          .order("createdAt", { ascending: false });
        if (error) return [];
        return (data ?? [])
          .map((row: AnyRecord) => ({
            voiceId: String(row.voiceId ?? "").trim(),
            name: String(row.name ?? ""),
            gender: String(row.gender ?? ""),
            locale: String(row.locale ?? ""),
            previewUrl: String(row.previewUrl ?? ""),
            tagsJson: typeof row.tagsJson === "string" ? row.tagsJson : "[]",
            createdAt: row.createdAt,
          }))
          .filter((v) => v.voiceId);
      } catch {
        return [];
      }
    },
    async insert(input: {
      voiceId: string;
      name: string;
      gender?: string;
      locale?: string;
      previewUrl?: string;
      tagsJson?: string;
    }) {
      const row = {
        voiceId: input.voiceId.trim(),
        name: input.name.trim(),
        gender: (input.gender ?? "").trim(),
        locale: (input.locale ?? "").trim(),
        previewUrl: (input.previewUrl ?? "").trim(),
        tagsJson: (input.tagsJson ?? "[]").trim() || "[]",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const { data, error } = await getSupabaseAdmin().from("CustomVoice").insert(row).select("*").limit(1);
      if (error) throw error;
      if (!data?.[0]) throw new Error("CustomVoice insert failed");
      return hydrateRecord(data[0] as AnyRecord);
    },
    async delete(voiceId: string) {
      const id = voiceId.trim();
      if (!id) throw new Error("voiceId обязателен");
      const { error } = await getSupabaseAdmin().from("CustomVoice").delete().eq("voiceId", id);
      if (error) throw error;
    },
  },
};
