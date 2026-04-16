/**
 * Одноразовая сборка: тянет официальную .md страницу ElevenLabs (premade voices)
 * и пишет lib/elevenlabs-premade-voices.json для мёрджа в /api/secret-voicer/voices.
 */
import fs from "node:fs";
import https from "node:https";

const SOURCE_URL = "https://elevenlabs-sdk.mintlify.app/voices/premade-voices.md";
const outFile = new URL("../lib/elevenlabs-premade-voices.json", import.meta.url);

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Accept: "text/markdown,text/plain,*/*" } }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject);
  });
}

const md = await fetchText(SOURCE_URL);
const lines = md.split("\n");
const voices = [];
for (const line of lines) {
  const t = line.trim();
  if (!t.startsWith("|")) continue;
  if (t.includes("name") && t.includes("voice")) continue;
  if (t.includes("---")) continue;
  const raw = t.split("|").map((c) => c.trim());
  if (raw.length < 4) continue;
  const cells = raw.slice(1, -1);
  if (cells.length < 8) continue;
  const name = cells[0];
  const voiceId = cells[1];
  const genderRaw = (cells[2] || "").toLowerCase();
  const accent = cells[4] || "";
  const m = t.match(/\[Sample\]\((https:\/\/[^)]+)\)/);
  if (!m || !voiceId || voiceId === "voice_id" || voiceId.includes("\\")) continue;
  const gender = genderRaw === "female" ? "FEMALE" : "MALE";
  const locale =
    accent.includes("british") || accent.includes("english")
      ? "en-GB"
      : accent.includes("russian")
        ? "ru-RU"
        : "en-US";
  const tags = [accent, cells[3], cells[4], cells[5]].filter(Boolean).map((s) => String(s).toLowerCase());
  voices.push({
    id: voiceId,
    name,
    gender,
    locale,
    preview_audio_url: m[1],
    voice_style_tags: [...new Set(tags)].filter((x) => x.length > 1),
    usage_count: 0,
  });
}

fs.mkdirSync(new URL("../lib/", import.meta.url), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ voices }, null, 0), "utf8");
console.log("wrote", outFile.pathname || outFile.href, "count", voices.length);
