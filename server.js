import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { processTelegramUpdate } from "./functions/lib/bot-commands.js";
import {
  getStoreConfig,
  normalizePaymentMethod,
  dbPaymentMethod,
  buildOrderTelegramMessage,
  notifyOrderTelegram as notifyOrderTelegramShared,
  insertOrder as insertOrderShared,
  getSupabase,
  sendTelegram as sendTelegramShared
} from "./functions/lib/store.js";
import {
  createStarsCheckout,
  loadStarsInvoice,
  starsEnabled,
  usdToStars
} from "./functions/lib/stars.js";
import {
  createEscrowSession,
  getDepositAddress,
  getEscrowByCode,
  getEscrowMessages,
  getEscrowTransactions,
  isAdminBearer,
  listEscrowSessions,
  transitionEscrow
} from "./functions/lib/escrow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

async function sendTelegram(chatId, message, options = {}) {
  return sendTelegramShared(process.env, chatId, message, options);
}

async function notifyOrderTelegram(message) {
  await notifyOrderTelegramShared(process.env, message);
}

async function insertOrder(orderPayload, items) {
  return insertOrderShared(process.env, orderPayload, items);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/visitor", (req, res) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.headers["cf-connecting-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";
  res.json({ ip, userAgent: req.headers["user-agent"] || "" });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    supabase: Boolean(supabaseAdmin),
    paystack: Boolean(process.env.PAYSTACK_PUBLIC_KEY),
    telegram: Boolean(
      process.env.TELEGRAM_BOT_TOKEN &&
        (process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHANNEL_ID)
    ),
    telegramAdmin: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID),
    telegramChannel: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID),
    usdt: Boolean(process.env.USDT_TRC20_ADDRESS),
    btc: Boolean(process.env.BTC_ADDRESS)
  });
});

app.get("/api/config", (_req, res) => {
  res.json(getStoreConfig(process.env));
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      telegramUsername,
      paymentMethod,
      paymentReference,
      productAccount,
      deliveryDetails,
      items,
      totalUsd,
      visitorIp,
      userAgent
    } = req.body;

    if (!customerName || !customerEmail || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Missing required order fields." });
    }

    const normalizedMethod = normalizePaymentMethod(paymentMethod);
    const deliveryBlock = [
      `Email: ${customerEmail}`,
      `Payment option: ${normalizedMethod}`,
      paymentReference ? `Payment reference: ${paymentReference}` : null,
      productAccount ? `Product account: ${productAccount}` : null,
      deliveryDetails || null
    ]
      .filter(Boolean)
      .join("\n");

    const orderId = await insertOrder(
      {
        customer_name: customerName,
        customer_phone: customerEmail,
        customer_email: customerEmail,
        telegram_username: telegramUsername || null,
        delivery_details: deliveryBlock,
        payment_method: dbPaymentMethod(normalizedMethod),
        payment_reference: paymentReference || null,
        product_account: productAccount || null,
        total_usd: Number(totalUsd || 0)
      },
      items
    );

    const resolvedIp =
      visitorIp ||
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["cf-connecting-ip"] ||
      req.socket?.remoteAddress ||
      "unknown";
    const resolvedAgent = userAgent || req.headers["user-agent"] || "";

    const telegramMessage = buildOrderTelegramMessage({
      customerName,
      customerEmail,
      telegramUsername,
      normalizedMethod,
      paymentReference,
      productAccount,
      totalUsd,
      items,
      orderId,
      visitorIp: resolvedIp,
      userAgent: resolvedAgent
    });

    await notifyOrderTelegram(telegramMessage);

    res.json({ ok: true, orderId });
  } catch (error) {
    console.error("Order error:", error);
    res.status(500).json({
      error: error.message || "Could not save order. Check Supabase service role key in .env."
    });
  }
});

app.post("/api/paystack/initialize", async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "Paystack secret key not configured." });

    const email = String(req.body.email || "").trim();
    const name = String(req.body.name || "").trim();
    const amountUsd = Number(req.body.amountUsd || 0);
    if (!email || !(amountUsd > 0)) {
      return res.status(400).json({ error: "Email and amount are required." });
    }

    const currency = process.env.PAYSTACK_CURRENCY || "KES";
    const rate = Number(process.env.PAYSTACK_CONVERSION_RATE || 129);
    const amount = Math.round(amountUsd * rate * 100);
    const reference = String(req.body.reference || `DTD-${Date.now()}`);

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        amount,
        currency,
        reference,
        callback_url: `${req.protocol}://${req.get("host")}/?paid=1&reference=${encodeURIComponent(reference)}`,
        metadata: {
          customer_name: name,
          amount_usd: amountUsd,
          cart_items: req.body.cartItems || ""
        }
      })
    });

    const payload = await response.json();

    if (!response.ok || !payload.status) {
      return res.status(400).json({
        error: payload.message || "Could not start Paystack payment.",
        code: payload.code
      });
    }

    res.json({
      ok: true,
      reference: payload.data.reference,
      access_code: payload.data.access_code,
      authorization_url: payload.data.authorization_url,
      currency,
      amount
    });
  } catch (error) {
    console.error("Paystack initialize error:", error);
    res.status(500).json({ error: "Paystack initialize failed." });
  }
});

app.post("/api/paystack/verify", async (req, res) => {
  try {
    const reference = String(req.body.reference || "").trim();
    if (!reference) return res.status(400).json({ error: "Missing reference." });

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "Paystack secret key not configured." });

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` }
    });

    const payload = await response.json();
    if (!response.ok || !payload.status) {
      return res.status(400).json({ error: payload.message || "Verification failed." });
    }

    res.json({
      ok: true,
      paid: payload.data.status === "success",
      amount: payload.data.amount,
      currency: payload.data.currency,
      reference: payload.data.reference
    });
  } catch (error) {
    console.error("Paystack verify error:", error);
    res.status(500).json({ error: "Paystack verification failed." });
  }
});

// Debug probe: confirms merchant currency works with current .env
app.post("/api/paystack/probe", async (_req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const currency = process.env.PAYSTACK_CURRENCY || "KES";
    const rate = Number(process.env.PAYSTACK_CONVERSION_RATE || 129);
    if (!secret) return res.status(500).json({ error: "Missing secret" });

    const amount = Math.round(49 * rate * 100);
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: "debug-probe@example.com",
        amount,
        currency,
        reference: `DTD-PROBE-${Date.now()}`
      })
    });
    const payload = await response.json();
    res.status(response.ok ? 200 : 400).json({
      ok: Boolean(payload.status),
      currency,
      rate,
      amount,
      message: payload.message,
      code: payload.code
    });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.post("/api/telegram/message", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    const name = String(req.body.name || "Store visitor").trim();
    const contact = String(req.body.contact || "").trim();

    if (!message) return res.status(400).json({ error: "Message is required." });

    const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
    const result = await sendTelegram(
      adminChat,
      [
        "<b>DTD Store chat</b>",
        `From: ${name}`,
        contact ? `Contact: ${contact}` : null,
        "",
        message
      ]
        .filter(Boolean)
        .join("\n")
    );

    if (!result.ok) {
      const detail =
        result.reason === "not_configured"
          ? "Telegram bot is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID to .env."
          : result.reason === "unauthorized"
            ? "Telegram bot token is invalid or revoked (401). Create a new token in @BotFather and update TELEGRAM_BOT_TOKEN in .env."
            : "Could not reach Telegram. Check TELEGRAM_BOT_TOKEN, admin chat ID, and that the bot can message you.";
      return res.status(503).json({ error: detail });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error("Telegram message error:", error);
    res.status(500).json({ error: "Could not send message." });
  }
});

app.post("/api/analytics", async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.events) || !body.events.length) {
      return res.json({ ok: true, skipped: true });
    }
    if (!supabaseAdmin) return res.json({ ok: true, stored: 0, reason: "no_store" });

    const clamp = (value, max) => String(value == null ? "" : value).slice(0, max);
    const now = Date.now();
    const rows = body.events.slice(0, 50).map((event) => ({
      client_id: clamp(body.clientId || "anon", 64),
      session_id: clamp(body.sessionId, 64),
      event_type: clamp(event.type || "event", 40),
      path: clamp(event.path, 200),
      referrer: clamp(body.referrer, 300),
      country: "",
      user_agent: clamp(body.userAgent || req.get("user-agent"), 300),
      data: event.data && typeof event.data === "object" ? event.data : {},
      created_at: new Date(Number(event.ts) || now).toISOString()
    }));

    const { error } = await supabaseAdmin.from("analytics_events").insert(rows);
    if (error) return res.json({ ok: true, stored: 0, warn: error.message });
    res.json({ ok: true, stored: rows.length });
  } catch (error) {
    res.json({ ok: true, error: String(error?.message || error) });
  }
});

app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const header = req.get("X-Telegram-Bot-Api-Secret-Token");
      if (header !== secret) return res.status(403).json({ error: "Forbidden" });
    }

    await processTelegramUpdate(process.env, req.body, {
      getSupabase: () => supabaseAdmin || getSupabase(process.env),
      sendTelegram: async (_env, chatId, message, options) => sendTelegram(chatId, message, options)
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    res.json({ ok: true });
  }
});

app.post("/api/stars/invoice", async (req, res) => {
  try {
    if (!starsEnabled(process.env)) {
      return res.status(400).json({ ok: false, error: "Stars payments are not enabled." });
    }
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    const totalUsd = Number(body.totalUsd || 0);
    if (!items.length && !(totalUsd > 0)) {
      return res.status(400).json({ ok: false, error: "Cart is empty." });
    }
    const result = await createStarsCheckout(process.env, {
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
    if (!result.ok) return res.status(400).json(result);
    res.json({
      ok: true,
      invoice_url: result.invoice_url,
      id: result.id,
      stars: result.stars,
      amountUsd: result.amountUsd,
      rate: usdToStars(process.env, 1)
    });
  } catch (error) {
    console.error("Stars invoice error:", error);
    res.status(500).json({ ok: false, error: error.message || "Stars invoice failed" });
  }
});

app.get("/api/stars/invoice", async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    if (id) {
      const row = await loadStarsInvoice(process.env, id);
      if (!row) return res.status(404).json({ ok: false, error: "Invoice not found" });
      return res.json({
        ok: true,
        id: row.id,
        status: row.status,
        orderId: row.order_id || null,
        stars: row.stars_amount,
        totalUsd: row.total_usd
      });
    }
    res.json({
      ok: true,
      starsEnabled: starsEnabled(process.env),
      starsPerUsd: Number(process.env.STARS_PER_USD || 75)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Stars lookup failed" });
  }
});

app.get("/api/orders/status", async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "").trim();
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!orderId || !email) {
      return res.status(400).json({ error: "Provide orderId and email." });
    }
    const supabase = supabaseAdmin || getSupabase(process.env);
    if (!supabase) return res.status(503).json({ error: "Order lookup unavailable." });

    const { data, error } = await supabase
      .from("orders")
      .select(
        "id,order_status,payment_method,payment_status,total_usd,created_at,customer_email,customer_phone,customer_name"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: "Could not look up that order." });
    if (!data) return res.status(404).json({ error: "Order not found." });

    const storedEmail = String(data.customer_email || data.customer_phone || "")
      .trim()
      .toLowerCase();
    if (storedEmail !== email) {
      return res.status(403).json({ error: "Email does not match this order." });
    }

    const labels = {
      new: "Order received",
      confirmed: "Confirmed",
      delivered: "Delivered",
      cancelled: "Cancelled",
      pending: "Payment pending",
      paid: "Paid",
      failed: "Payment failed",
      refunded: "Refunded"
    };
    const orderStatus = data.order_status || "new";
    const paymentStatus = data.payment_status || "pending";
    res.json({
      ok: true,
      order: {
        id: data.id,
        status: orderStatus,
        statusLabel: labels[orderStatus] || orderStatus,
        paymentStatus,
        paymentStatusLabel: labels[paymentStatus] || paymentStatus,
        paymentMethod: data.payment_method,
        totalUsd: Number(data.total_usd || 0),
        createdAt: data.created_at,
        customerName: data.customer_name
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Lookup failed." });
  }
});

app.get("/api/escrow/session", async (req, res) => {
  try {
    const result = await getEscrowByCode(process.env, req.query.code);
    if (!result.ok) {
      return res.status(result.error === "Escrow not found." ? 404 : 400).json({ error: result.error });
    }
    const { session } = result;
    const transactions = await getEscrowTransactions(process.env, session.id);
    const messages = await getEscrowMessages(process.env, session.id);
    res.json({
      ok: true,
      session: {
        id: session.id,
        code: session.code,
        title: session.title,
        description: session.description,
        amountUsd: Number(session.amount_usd || 0),
        currency: session.currency,
        asset: session.asset,
        network: session.network,
        buyerTelegram: session.buyer_telegram,
        sellerTelegram: session.seller_telegram,
        depositAddress: session.deposit_address,
        escrowFee: Number(session.escrow_fee || 0),
        status: session.status,
        createdAt: session.created_at,
        fundedAt: session.funded_at,
        releasedAt: session.released_at
      },
      transactions,
      messages
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load escrow." });
  }
});

app.get("/api/escrow", async (req, res) => {
  try {
    const handle = String(req.query.handle || "").trim().replace(/^@/, "");
    if (!handle) return res.status(400).json({ error: "Provide a Telegram handle." });
    const supabase = supabaseAdmin || getSupabase(process.env);
    if (!supabase) return res.status(503).json({ error: "Escrow storage unavailable." });
    const { data, error } = await supabase
      .from("escrow_sessions")
      .select("code,title,amount_usd,status,created_at,buyer_telegram,seller_telegram")
      .or(`buyer_telegram.eq.@${handle},seller_telegram.eq.@${handle}`)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return res.status(500).json({ error: error.message || "Lookup failed." });
    res.json({
      ok: true,
      handle,
      escrows: (data || []).map((s) => ({
        code: s.code,
        title: s.title,
        amountUsd: Number(s.amount_usd || 0),
        status: s.status,
        createdAt: s.created_at,
        buyerTelegram: s.buyer_telegram,
        sellerTelegram: s.seller_telegram
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Escrow lookup failed." });
  }
});

app.get("/api/escrow/admin", async (req, res) => {
  try {
    const fakeReq = {
      headers: { get: (name) => req.get(name) }
    };
    if (!(await isAdminBearer(process.env, fakeReq))) {
      return res.status(401).json({ error: "Admin access required." });
    }
    const sessions = await listEscrowSessions(process.env);
    res.json({ ok: true, depositAddress: getDepositAddress(process.env), sessions });
  } catch (error) {
    res.status(500).json({ error: error.message || "Escrow list failed." });
  }
});

app.post("/api/escrow/admin", async (req, res) => {
  try {
    const fakeReq = {
      headers: { get: (name) => req.get(name) }
    };
    if (!(await isAdminBearer(process.env, fakeReq))) {
      return res.status(401).json({ error: "Admin access required." });
    }
    const body = req.body || {};
    const action = String(body.action || "create").toLowerCase();
    if (action === "create") {
      const result = await createEscrowSession(process.env, body);
      if (!result.ok) return res.status(400).json({ error: result.error });
      return res.json({ ok: true, session: result.session });
    }
    if (["release", "cancel", "dispute", "confirm_deposit"].includes(action)) {
      const statusMap = {
        release: "released",
        cancel: "cancelled",
        dispute: "disputed",
        confirm_deposit: "funded"
      };
      const result = await transitionEscrow(process.env, body.sessionId, statusMap[action], {
        actor: "admin",
        txHash: body.txHash || null,
        message: body.reason || body.note || null
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      return res.json({ ok: true, [statusMap[action]]: true });
    }
    res.status(400).json({ error: "Unknown action." });
  } catch (error) {
    res.status(500).json({ error: error.message || "Escrow admin failed." });
  }
});

app.use(express.static(__dirname));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`DTD Store running at http://localhost:${PORT}`);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("Warning: SUPABASE_SERVICE_ROLE_KEY is missing. Order saves may fail due to RLS.");
  }
  if (
    !process.env.TELEGRAM_BOT_TOKEN ||
    (!process.env.TELEGRAM_ADMIN_CHAT_ID && !process.env.TELEGRAM_CHANNEL_ID)
  ) {
    console.warn("Warning: Telegram bot not fully configured in .env.");
  }
});
