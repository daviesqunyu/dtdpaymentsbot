/**
 * Secretary mode — admin assistant for payments, messages, reminders, inbox.
 * Reminders are processed lazily on each webhook hit (no VPS / cron change).
 */

import { getSupabase, paymentStatusView } from "./store.js";
import { PX, premiumDivider, premiumHeader, numberEmoji } from "./tg-premium.js";

const memoryReminders = new Map(); // fallback when DB table missing
const memoryNotes = [];

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseDelay(token) {
  const raw = String(token || "").trim().toLowerCase();
  if (!raw) return null;
  const m = raw.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] || "m").slice(0, 1);
  const mult = unit === "h" ? 60 : unit === "d" ? 1440 : 1;
  const minutes = n * mult;
  if (minutes > 60 * 24 * 30) return null; // max 30 days
  return minutes;
}

export function secretaryHelpText() {
  return [
    premiumHeader("Secretary mode", PX.key),
    premiumDivider(),
    "Your admin assistant for payments, follow-ups, and reminders.",
    "",
    `${PX.bolt} <b>Commands</b>`,
    "/secretary — status + quick menu",
    "/inbox — unpaid / pending orders needing action",
    "/remind 30m Follow up Order ABC — set reminder",
    "/reminders — list open reminders",
    "/sec pay &lt;orderId&gt; — draft payment follow-up",
    "/sec msg &lt;chatId|@user&gt; text — send as secretary",
    "/sec note text — save a note",
    "/sec notes — list recent notes",
    "",
    `${PX.clock} Reminders fire when the bot receives any update (lazy scheduler).`,
    `${PX.mail} Pair with /paid /fail /orders /payments for ops.`
  ].join("\n");
}

export async function processDueReminders(env, deps) {
  const now = new Date().toISOString();
  const supabase = getSupabase(env);
  let due = [];

  if (supabase) {
    const { data, error } = await supabase
      .from("bot_reminders")
      .select("*")
      .eq("status", "pending")
      .lte("due_at", now)
      .limit(20);
    if (!error && Array.isArray(data)) due = data;
  }

  for (const [id, row] of memoryReminders.entries()) {
    if (row.status === "pending" && row.due_at <= now) due.push({ ...row, id, _memory: true });
  }

  for (const row of due) {
    const chatId = row.chat_id || env.TELEGRAM_ADMIN_CHAT_ID;
    if (!chatId) continue;
    const text = [
      `${PX.clock} <b>Reminder</b>`,
      premiumDivider(),
      esc(row.message || "(no message)"),
      row.meta ? `\n${esc(row.meta)}` : null
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await deps.sendTelegram(env, chatId, text);
    } catch {
      /* continue */
    }
    if (row._memory) {
      memoryReminders.set(row.id, { ...row, status: "done" });
    } else if (supabase) {
      await supabase
        .from("bot_reminders")
        .update({ status: "done", fired_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  }

  return { fired: due.length };
}

async function createReminder(env, { chatId, userId, minutes, message, meta }) {
  const due = new Date(Date.now() + minutes * 60 * 1000);
  const row = {
    chat_id: String(chatId),
    created_by: userId ? String(userId) : null,
    message: String(message || "").slice(0, 1500),
    meta: meta || null,
    due_at: due.toISOString(),
    status: "pending"
  };

  const supabase = getSupabase(env);
  if (supabase) {
    const { data, error } = await supabase.from("bot_reminders").insert(row).select("id,due_at").maybeSingle();
    if (!error && data?.id) {
      return { ok: true, id: data.id, due_at: data.due_at, storage: "db" };
    }
  }

  const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  memoryReminders.set(id, { ...row, id });
  return { ok: true, id, due_at: row.due_at, storage: "memory" };
}

async function listReminders(env, chatId) {
  const supabase = getSupabase(env);
  const out = [];
  if (supabase) {
    const { data } = await supabase
      .from("bot_reminders")
      .select("id,message,due_at,status")
      .eq("chat_id", String(chatId))
      .eq("status", "pending")
      .order("due_at", { ascending: true })
      .limit(15);
    if (Array.isArray(data)) out.push(...data);
  }
  for (const row of memoryReminders.values()) {
    if (row.status === "pending" && String(row.chat_id) === String(chatId)) {
      out.push(row);
    }
  }
  return out.sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
}

async function saveNote(env, { userId, text }) {
  const row = {
    created_by: userId ? String(userId) : null,
    note: String(text || "").slice(0, 2000)
  };
  const supabase = getSupabase(env);
  if (supabase) {
    const { data, error } = await supabase.from("bot_secretary_notes").insert(row).select("id,created_at").maybeSingle();
    if (!error && data) return { ok: true, id: data.id, storage: "db" };
  }
  memoryNotes.unshift({ ...row, id: `n_${Date.now()}`, created_at: new Date().toISOString() });
  if (memoryNotes.length > 40) memoryNotes.length = 40;
  return { ok: true, storage: "memory" };
}

async function listNotes(env) {
  const supabase = getSupabase(env);
  if (supabase) {
    const { data } = await supabase
      .from("bot_secretary_notes")
      .select("id,note,created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    if (Array.isArray(data) && data.length) return data;
  }
  return memoryNotes.slice(0, 10);
}

async function pendingOrders(env) {
  const supabase = getSupabase(env);
  if (!supabase) return [];
  const { data } = await supabase
    .from("orders")
    .select("id,customer_name,customer_email,payment_method,payment_status,total_usd,created_at,telegram_username")
    .in("payment_status", ["pending", "processing", "unpaid", "awaiting"])
    .order("created_at", { ascending: false })
    .limit(12);
  return Array.isArray(data) ? data : [];
}

function formatInbox(orders) {
  if (!orders.length) {
    return [
      premiumHeader("Inbox · payments", PX.inbox),
      premiumDivider(),
      `${PX.check} No pending payment orders right now.`
    ].join("\n");
  }
  const lines = orders.map((o, i) => {
    const view = paymentStatusView(o.payment_status);
    return [
      `${numberEmoji(i + 1)} <code>${esc(o.id)}</code>`,
      `   ${esc(o.customer_name || "—")} · $${Number(o.total_usd || 0).toFixed(2)}`,
      `   ${view.icon} ${esc(view.label)} · ${esc(o.payment_method || "n/a")}`,
      o.telegram_username ? `   @${esc(String(o.telegram_username).replace(/^@/, ""))}` : null
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    premiumHeader("Inbox · needs attention", PX.inbox),
    premiumDivider(),
    ...lines,
    "",
    "Tip: /sec pay &lt;orderId&gt; · /paid &lt;orderId&gt; · /remind 1h Follow up"
  ].join("\n");
}

async function resolveTargetChat(env, target) {
  const raw = String(target || "").trim();
  if (!raw) return null;
  if (/^-?\d+$/.test(raw)) return raw;
  const username = raw.replace(/^@/, "");
  // Telegram Bot API can't resolve usernames to chat ids without a prior chat —
  // return deep-link style failure; try getChat with @username (works if public).
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: `@${username}` })
    });
    const data = await response.json();
    if (data.ok && data.result?.id) return String(data.result.id);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Handle secretary slash commands. Returns reply object or null.
 */
export async function handleSecretaryCommand(env, { cmd, arg, chatId, from }, deps) {
  const adminId = String(env.TELEGRAM_ADMIN_CHAT_ID || "");
  const isAdmin = String(chatId) === adminId || String(from?.id || "") === adminId;

  if (!["secretary", "sec", "remind", "reminders", "inbox"].includes(cmd)) {
    return null;
  }

  if (!isAdmin) {
    return { text: `${PX.lock} Secretary mode is admin-only. Contact support if you need help.` };
  }

  if (cmd === "secretary") {
    return {
      text: secretaryHelpText(),
      reply_markup: {
        inline_keyboard: [
          [{ text: `${PX.inbox} Open inbox`, callback_data: "sec:inbox" }],
          [{ text: `${PX.clock} List reminders`, callback_data: "sec:reminders" }],
          [{ text: `${PX.bag} Shop menu`, callback_data: "shop:menu" }]
        ]
      }
    };
  }

  if (cmd === "inbox") {
    const orders = await pendingOrders(env);
    return { text: formatInbox(orders) };
  }

  if (cmd === "reminders") {
    const list = await listReminders(env, chatId);
    if (!list.length) {
      return { text: `${PX.clock} No pending reminders.\nSet one: <code>/remind 30m Message text</code>` };
    }
    const body = list
      .map((r, i) => `${numberEmoji(i + 1)} <b>${esc(r.due_at)}</b>\n   ${esc(r.message)}`)
      .join("\n\n");
    return { text: `${premiumHeader("Reminders", PX.clock)}\n${premiumDivider()}\n${body}` };
  }

  if (cmd === "remind") {
    const parts = String(arg || "").trim().split(/\s+/);
    const minutes = parseDelay(parts[0]);
    const message = parts.slice(1).join(" ").trim();
    if (!minutes || !message) {
      return {
        text: [
          `${PX.clock} <b>Set a reminder</b>`,
          "Usage: <code>/remind 30m Follow up Order ABC</code>",
          "Units: m · h · d  (example: <code>/remind 2h Ping client</code>)"
        ].join("\n")
      };
    }
    const created = await createReminder(env, {
      chatId,
      userId: from?.id,
      minutes,
      message
    });
    return {
      text: [
        `${PX.check} Reminder set`,
        `When: <b>${esc(created.due_at)}</b> (in ${minutes} min)`,
        `Note: ${esc(message)}`,
        created.storage === "memory"
          ? `${PX.warn} Stored in memory (run supabase-secretary-earn.sql for persistence).`
          : null
      ]
        .filter(Boolean)
        .join("\n")
    };
  }

  if (cmd === "sec") {
    const rest = String(arg || "").trim();
    const [sub, ...tail] = rest.split(/\s+/);
    const subCmd = String(sub || "").toLowerCase();
    const body = tail.join(" ").trim();

    if (!subCmd || subCmd === "help") {
      return { text: secretaryHelpText() };
    }

    if (subCmd === "notes") {
      const notes = await listNotes(env);
      if (!notes.length) return { text: `${PX.pin} No secretary notes yet. Add with /sec note …` };
      return {
        text: [
          premiumHeader("Secretary notes", PX.pin),
          premiumDivider(),
          ...notes.map((n, i) => `${numberEmoji(i + 1)} ${esc(n.note)}\n   <i>${esc(n.created_at || "")}</i>`)
        ].join("\n")
      };
    }

    if (subCmd === "note") {
      if (!body) return { text: "Usage: /sec note Call supplier about SMTP stock" };
      await saveNote(env, { userId: from?.id, text: body });
      return { text: `${PX.check} Note saved.` };
    }

    if (subCmd === "pay") {
      const orderId = body.split(/\s+/)[0];
      if (!orderId) return { text: "Usage: /sec pay ORDER_ID" };
      const supabase = getSupabase(env);
      if (!supabase) return { text: "Database unavailable." };
      const { data: order } = await supabase
        .from("orders")
        .select("id,customer_name,customer_email,payment_method,payment_status,total_usd,telegram_username")
        .eq("id", orderId)
        .maybeSingle();
      if (!order) return { text: "Order not found." };
      const view = paymentStatusView(order.payment_status);
      const draft = [
        `Hi ${order.customer_name || "there"},`,
        "",
        `This is DTD Store regarding order ${order.id}.`,
        `Status: ${view.label}. Amount: $${Number(order.total_usd || 0).toFixed(2)}.`,
        "If you already paid, reply with your tx hash / Paystack ref, or pay here:",
        String(env.STORE_URL || "https://dtdpaymentsbot.pages.dev").replace(/\/$/, "") + "/#checkout",
        "",
        "Need help? Reply to this chat or email support."
      ].join("\n");
      return {
        text: [
          premiumHeader("Payment follow-up draft", PX.mail),
          premiumDivider(),
          `${view.icon} ${esc(view.label)} · ${esc(order.payment_method || "n/a")}`,
          `Customer: ${esc(order.customer_name || "—")} · ${esc(order.customer_email || "—")}`,
          order.telegram_username
            ? `Telegram: @${esc(String(order.telegram_username).replace(/^@/, ""))}`
            : null,
          "",
          "<b>Copy / send:</b>",
          `<pre>${esc(draft)}</pre>`,
          "",
          "Send via: /sec msg CHAT_ID paste text",
          `Or remind yourself: /remind 2h Follow up ${orderId}`
        ]
          .filter(Boolean)
          .join("\n")
      };
    }

    if (subCmd === "msg") {
      const [target, ...msgParts] = body.split(/\s+/);
      const text = msgParts.join(" ").trim();
      if (!target || !text) {
        return { text: "Usage: /sec msg &lt;chatId|@channel&gt; Your message" };
      }
      const dest = await resolveTargetChat(env, target);
      if (!dest) {
        return {
          text: `${PX.warn} Could not resolve <code>${esc(target)}</code>. Use a numeric chat id (user must have started the bot).`
        };
      }
      const sent = await deps.sendTelegram(
        env,
        dest,
        [
          `${PX.spark} <b>Message from DTD secretary</b>`,
          premiumDivider(),
          esc(text)
        ].join("\n")
      );
      return {
        text: sent.ok
          ? `${PX.check} Sent to <code>${esc(dest)}</code>`
          : `${PX.warn} Send failed: ${esc(sent.detail || sent.reason || "unknown")}`
      };
    }

    return { text: `Unknown /sec action. Try /secretary` };
  }

  return null;
}

export async function handleSecretaryCallback(env, query, deps) {
  const data = String(query?.data || "");
  if (!data.startsWith("sec:")) return { handled: false };

  const chatId = query.message?.chat?.id;
  const adminId = String(env.TELEGRAM_ADMIN_CHAT_ID || "");
  const isAdmin = String(chatId) === adminId || String(query.from?.id || "") === adminId;

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: query.id })
  }).catch(() => null);

  if (!isAdmin) {
    await deps.sendTelegram(env, chatId, `${PX.lock} Admin only.`);
    return { handled: true };
  }

  if (data === "sec:inbox") {
    const orders = await pendingOrders(env);
    await deps.sendTelegram(env, chatId, formatInbox(orders));
    return { handled: true };
  }

  if (data === "sec:reminders") {
    const list = await listReminders(env, chatId);
    const text = list.length
      ? `${premiumHeader("Reminders", PX.clock)}\n${premiumDivider()}\n${list
          .map((r, i) => `${numberEmoji(i + 1)} <b>${esc(r.due_at)}</b>\n   ${esc(r.message)}`)
          .join("\n\n")}`
      : `${PX.clock} No pending reminders.`;
    await deps.sendTelegram(env, chatId, text);
    return { handled: true };
  }

  return { handled: true };
}
