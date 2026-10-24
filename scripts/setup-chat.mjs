import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL / service key in .env");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function tableExists(name) {
  try {
    const r = await fetch(`${URL}/rest/v1/${name}?select=id&limit=1`, { headers: H });
    return r.status !== 404;
  } catch {
    return false;
  }
}

async function main() {
  const tables = [
    "chat_messages",
    "chat_likes",
    "chat_comments",
    "chat_link_codes",
    "chat_users",
    "chat_sessions"
  ];
  const missing = [];
  for (const t of tables) {
    const ok = await tableExists(t);
    console.log(`${ok ? "OK  " : "MISS"} ${t}`);
    if (!ok) missing.push(t);
  }
  if (missing.length) {
    console.log(
      `\nMissing tables: ${missing.join(", ")}.\nRun supabase-chat.sql in the Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql).`
    );
  }

  const buckets = await fetch(`${URL}/storage/v1/bucket`, { headers: H }).then((r) => r.json());
  const has = Array.isArray(buckets) && buckets.some((b) => b.id === "chat-media");
  if (!has) {
    const r = await fetch(`${URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "chat-media",
        name: "chat-media",
        public: true,
        file_size_limit: 8 * 1024 * 1024,
        allowed_mime_types: [
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "image/bmp",
          "video/mp4",
          "video/webm",
          "video/quicktime"
        ]
      })
    });
    const data = await r.json().catch(() => ({}));
    console.log(r.ok ? "OK   created storage bucket chat-media" : `FAIL bucket create: ${JSON.stringify(data)}`);
  } else {
    console.log("OK   storage bucket chat-media exists");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
