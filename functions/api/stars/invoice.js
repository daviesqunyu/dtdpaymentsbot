import { json } from "../../lib/store.js";
import {
  createStarsCheckout,
  loadStarsInvoice,
  starsEnabled,
  usdToStars
} from "../../lib/stars.js";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    if (!starsEnabled(env)) {
      return json({ ok: false, error: "Stars payments are not enabled." }, 400);
    }

    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    const totalUsd = Number(body.totalUsd || 0);
    if (!items.length && !(totalUsd > 0)) {
      return json({ ok: false, error: "Cart is empty." }, 400);
    }

    const result = await createStarsCheckout(env, {
      kind: "miniapp",
      telegramUserId: body.telegramUserId || body.userId || null,
      customerName: body.name || body.customerName || "Mini App buyer",
      customerEmail: body.email || body.customerEmail || null,
      telegramUsername: body.telegram || body.telegramUsername || null,
      items: items.map((item) => ({
        product_id: item.product_id || item.id || "",
        product_name: item.product_name || item.name || "Product",
        quantity: Number(item.quantity || 1),
        unit_price_usd: Number(item.unit_price_usd || item.price_usd || 0)
      })),
      totalUsd
    });

    if (!result.ok) return json(result, 400);
    return json({
      ok: true,
      invoice_url: result.invoice_url,
      id: result.id,
      stars: result.stars,
      amountUsd: result.amountUsd,
      rate: usdToStars(env, 1)
    });
  } catch (error) {
    return json({ ok: false, error: error.message || "Stars invoice failed" }, 500);
  }
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (id) {
    const row = await loadStarsInvoice(env, id);
    if (!row) return json({ ok: false, error: "Invoice not found" }, 404);
    return json({
      ok: true,
      id: row.id,
      status: row.status,
      orderId: row.order_id || null,
      stars: row.stars_amount,
      totalUsd: row.total_usd
    });
  }
  return json({
    ok: true,
    starsEnabled: starsEnabled(env),
    starsPerUsd: Number(env.STARS_PER_USD || 75),
    hint: "POST cart details to create a Telegram Stars invoice link."
  });
}
