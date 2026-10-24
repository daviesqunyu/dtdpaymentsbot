const fs = require("fs");

const raw = fs.readFileSync(".env", "utf-8").replace(/^\uFEFF/, "");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

(async () => {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/products?select=*`,
    {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    }
  );
  if (!resp.ok) {
    console.log("HTTP", resp.status, await resp.text());
    process.exit(1);
  }
  const data = await resp.json();
  console.log("COUNT:", data.length);
  console.log("COLUMNS:", Object.keys(data[0] || {}).join(", "));
  for (const p of data) {
    const img = p.image_url || p.image || "";
    console.log(
      JSON.stringify({
        id: p.id,
        name: p.name,
        desc: (p.description || "").slice(0, 90),
        price_usd: p.price_usd,
        price_kes: p.price_kes,
        active: p.active,
        img: img.slice(0, 80),
      })
    );
  }
})();
