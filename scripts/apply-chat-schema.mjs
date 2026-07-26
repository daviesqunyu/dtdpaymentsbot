/**
 * Apply supabase-chat.sql using the PostgREST-less approach:
 * runs statements via Supabase SQL if DATABASE_URL is set,
 * otherwise prints the SQL path for the dashboard editor.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = resolve(root, "supabase-chat.sql");

function loadEnv() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Probe: if table exists, skip. If not, we cannot DDL via REST — print instructions.
const { error } = await supabase.from("chat_messages").select("id").limit(1);
if (!error) {
  console.log("chat_messages already exists — OK");
  process.exit(0);
}

console.log("chat_messages missing:", error.message);
console.log("");
console.log("Open Supabase → SQL Editor and run:");
console.log(sqlPath);
console.log("");
console.log("--- SQL preview (first 20 lines) ---");
console.log(sql.split(/\r?\n/).slice(0, 20).join("\n"));
process.exit(2);
