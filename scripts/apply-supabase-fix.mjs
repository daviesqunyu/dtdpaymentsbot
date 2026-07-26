/**
 * Apply supabase-full-fix.sql using a direct Postgres connection.
 *
 * Usage (PowerShell):
 *   $env:SUPABASE_DB_PASSWORD="your-db-password"
 *   node scripts/apply-supabase-fix.mjs
 *
 * Password: Supabase Dashboard → Project Settings → Database → Database password
 * (or reset it there if unknown)
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const projectRef = "iqoffsnkptulvuqmdcce";
const password =
  process.env.SUPABASE_DB_PASSWORD ||
  process.env.POSTGRES_PASSWORD ||
  process.env.DATABASE_PASSWORD ||
  "";

if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  console.error("Set it from Supabase → Project Settings → Database → Database password");
  console.error("Then run: node scripts/apply-supabase-fix.mjs");
  console.error("");
  console.error("Or paste supabase-full-fix.sql in the SQL Editor and click Run:");
  console.error(`https://supabase.com/dashboard/project/${projectRef}/sql/new`);
  process.exit(1);
}

let pg;
try {
  pg = require("pg");
} catch {
  console.error("Installing pg...");
  const { spawnSync } = await import("child_process");
  const r = spawnSync("npm", ["install", "pg", "--no-save"], { stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(1);
  pg = require("pg");
}

const sql = readFileSync(new URL("../supabase-full-fix.sql", import.meta.url), "utf8");
const encoded = encodeURIComponent(password);
const urls = [
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres:${encoded}@db.${projectRef}.supabase.co:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
];

let lastError = null;
for (const connectionString of urls) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    console.log("[ok] connected");
    await client.query(sql);
    console.log("[ok] supabase-full-fix.sql applied");
    await client.end();
    process.exit(0);
  } catch (error) {
    lastError = error;
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    console.warn("[warn]", error.message);
  }
}

console.error("Could not apply migration:", lastError?.message || "unknown");
process.exit(1);
