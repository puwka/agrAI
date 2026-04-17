import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AnyRecord = any;

const globalForSupabase = globalThis as unknown as {
  supabaseAdmin: SupabaseClient | undefined;
};

function getSupabaseAdmin() {
  if (!globalForSupabase.supabaseAdmin) {
    const url = process.env.SUPABASE_URL ?? "";
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!url) throw new Error("SUPABASE_URL is not set");
    if (!serviceRole) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    globalForSupabase.supabaseAdmin = createClient(url, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return globalForSupabase.supabaseAdmin;
}

function nowIso() {
  return new Date().toISOString();
}

function hydrateRecord(row: AnyRecord) {
  const out: AnyRecord = { ...row };
  for (const key of ["createdAt", "updatedAt", "lastUsedAt", "restrictedUntil", "subscriptionUntil"]) {
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
  generation: {
    async findMany(args: { where?: AnyRecord; orderBy?: AnyRecord; take?: number; include?: AnyRecord } = {}) {
      const dir = String((args.orderBy?.createdAt as string) ?? "desc").toUpperCase() === "ASC" ? "ASC" : "DESC";
      const take = args.take ?? 1000;
      let q = getSupabaseAdmin().from("Generation").select("*");
      q = applyWhere(q, args.where);
      const { data, error } = await q.order("createdAt", { ascending: dir === "ASC" }).limit(take);
      if (error) throw error;
      const rows = hydrateRows((data ?? []) as AnyRecord[]);
      return withUserInclude(rows, args.include);
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
} as const;
