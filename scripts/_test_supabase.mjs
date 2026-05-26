import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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
loadEnv();

const url = (process.env.SUPABASE_URL ?? "").trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const headers = { apikey: key, Authorization: `Bearer ${key}` };

// Get just the ID & small fields for row 75
console.log("Fetching row 75 with just small cols...");
const resp = await fetch(
  `${url}/rest/v1/Generation?select=id,status,createdAt&order=createdAt.asc&limit=1&offset=75`,
  { headers }
);
const text = await resp.text();
console.log("Row 75 basic:", text);

const arr = JSON.parse(text);
if (arr[0]) {
  const id = arr[0].id;
  // Now try fetching each column individually for this specific row
  const cols = ["prompt", "referenceImageUrl", "resultUrl", "resultMessage", "errorMessage"];
  for (const col of cols) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const t0 = Date.now();
    try {
      const r = await fetch(
        `${url}/rest/v1/Generation?select=${col}&id=eq.${id}`,
        { headers, signal: controller.signal }
      );
      const t = await r.text();
      clearTimeout(timer);
      console.log(`  ${col}: ${t.length} bytes, ${Date.now()-t0}ms`);
      if (t.length > 10000) {
        console.log(`    LARGE! preview: ${t.slice(0, 200)}`);
      }
    } catch(e) {
      clearTimeout(timer);
      console.log(`  ${col}: TIMEOUT in ${Date.now()-t0}ms`);
    }
  }
}
