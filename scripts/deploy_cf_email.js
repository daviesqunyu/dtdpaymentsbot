/**
 * Push Cloudflare Email Sending secrets to Pages, then deploy.
 * Uses wrangler OAuth token (can send email) + account id.
 */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { join } from "path";

const project = "dtdpaymentsbot";
const accountId = "a2e2c51398c9594ae377828f88ad3d70";

const toml = readFileSync(
  join(homedir(), "AppData/Roaming/xdg.config/.wrangler/config/default.toml"),
  "utf8"
);
let token = "";
for (const line of toml.split(/\r?\n/)) {
  const m = line.match(/^\s*oauth_token\s*=\s*"([^"]+)"/);
  if (m) {
    token = m[1];
    break;
  }
}
if (!token) {
  console.error("No wrangler oauth_token found");
  process.exit(1);
}

const bulk = [
  `CF_ACCOUNT_ID=${accountId}`,
  `CLOUDFLARE_ACCOUNT_ID=${accountId}`,
  `CF_EMAIL_API_TOKEN=${token}`,
  `CLOUDFLARE_API_TOKEN=${token}`
].join("\n");

console.log("[..] pushing CF email secrets to Pages…");
const sec = spawnSync(
  "npx",
  ["wrangler", "pages", "secret", "bulk", "-", "--project-name", project],
  { input: bulk, stdio: ["pipe", "inherit", "inherit"], shell: true }
);
if ((sec.status ?? 1) !== 0) {
  console.error("secret push failed");
  process.exit(sec.status ?? 1);
}

console.log("[..] deploying Pages…");
const dep = spawnSync(
  "npx",
  ["wrangler", "pages", "deploy", ".", "--project-name", project, "--branch", "main", "--commit-dirty=true"],
  { stdio: "inherit", shell: true }
);
process.exit(dep.status ?? 1);
