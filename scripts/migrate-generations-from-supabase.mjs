/**
 * Однократный перенос заявок из Supabase Postgres в локальное хранилище сервера.
 *
 *   node scripts/migrate-generations-from-supabase.mjs
 *
 * Требует SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env (или окружении).
 * Не перезаписывает существующие id в .runtime/data/generations.json.
 */
import { readFileSync, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const storePath = path.join(root, ".runtime", "data", "generations.json");

function loadEnv() {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function loadLocalStore() {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.generations && typeof parsed.generations === "object") {
      return parsed;
    }
  } catch {
    // empty
  }
  return { version: 1, generations: {} };
}

async function persistLocalStore(store) {
  const dir = path.dirname(storePath);
  await mkdir(dir, { recursive: true });
  const tmp = `${storePath}.migrate.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 0), "utf8");
  await rename(tmp, storePath);
}

const GENERATION_COLUMNS = [
  "id","userId","modelId","modelName","inputMode","referenceImageUrl",
  "prompt","aspectRatio","status","resultUrl","resultMessage",
  "errorMessage","createdAt","updatedAt",
].join(",");

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

function timeoutPromise(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Body read timed out after ${ms}ms`)), ms),
  );
}

async function fetchWithRetry(fetchUrl, headers, attempt = 1) {
  try {
    const controller = new AbortController();
    const fetchTimer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(fetchUrl, { headers, signal: controller.signal });
    clearTimeout(fetchTimer);

    if (!resp.ok) {
      throw new Error(`Supabase ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }

    // Race body read against a separate timeout (AbortController doesn't help here)
    const json = await Promise.race([
      resp.json(),
      timeoutPromise(TIMEOUT_MS),
    ]);
    return json;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const wait = 1000 * 2 ** (attempt - 1);
      console.log(`  ↻ Retry ${attempt}/${MAX_RETRIES} after ${wait}ms (${err.message})`);
      await new Promise((r) => setTimeout(r, wait));
      return fetchWithRetry(fetchUrl, headers, attempt + 1);
    }
    throw err;
  }
}

async function fetchAllIds(url, headers) {
  const ids = [];
  const pageSize = 200;
  let offset = 0;
  while (true) {
    const batch = await fetchWithRetry(
      `${url}/rest/v1/Generation?select=id&limit=${pageSize}&offset=${offset}`,
      headers,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    ids.push(...batch.map((r) => r.id));
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return ids;
}

async function fetchRowsByIds(url, headers, ids) {
  const idsParam = ids.map((id) => `"${id}"`).join(",");
  return fetchWithRetry(
    `${url}/rest/v1/Generation?select=${GENERATION_COLUMNS}&id=in.(${idsParam})`,
    headers,
  );
}

async function fetchAllFromSupabase(url, key) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  process.stdout.write("  Phase 1: fetching IDs ...");
  const allIds = await fetchAllIds(url, headers);
  console.log(` ${allIds.length} IDs`);

  const batchSize = 20;
  const rows = [];
  for (let i = 0; i < allIds.length; i += batchSize) {
    const batchIds = allIds.slice(i, i + batchSize);
    process.stdout.write(`  Phase 2: ${i}–${i + batchIds.length} of ${allIds.length} ...`);
    const batch = await fetchRowsByIds(url, headers, batchIds);
    rows.push(...batch);
    console.log(` OK (${batch.length} rows)`);
  }
  return rows;
}

loadEnv();

const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
if (!supabaseUrl || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const remote = await fetchAllFromSupabase(supabaseUrl, serviceKey);
const store = await loadLocalStore();
let added = 0;
let skipped = 0;

for (const row of remote) {
  const id = String(row.id ?? "").trim();
  if (!id) continue;
  if (store.generations[id]) {
    skipped += 1;
    continue;
  }
  store.generations[id] = {
    id,
    userId: String(row.userId ?? ""),
    modelId: String(row.modelId ?? ""),
    modelName: String(row.modelName ?? ""),
    inputMode: String(row.inputMode ?? "TEXT"),
    referenceImageUrl: row.referenceImageUrl ?? null,
    prompt: String(row.prompt ?? ""),
    aspectRatio: String(row.aspectRatio ?? "16:9"),
    status: String(row.status ?? "PENDING"),
    resultUrl: row.resultUrl ?? null,
    resultMessage: row.resultMessage ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
  };
  added += 1;
}

await persistLocalStore(store);
console.log(`Done. Remote: ${remote.length}, added: ${added}, skipped (already local): ${skipped}`);
console.log(`Store: ${storePath}`);
