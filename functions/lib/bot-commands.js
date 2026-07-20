/**
 * Legitimate DTD Store bot commands only.
 * Products, payments, store links, channels, admin status — no carding/OTP tooling.
 */

const OWNER = "davetheedev";
const DEFAULT_STORE = "https://dtdpaymentsbot.pages.dev";

export function storeUrl(env) {
  return String(env.STORE_URL || DEFAULT_STORE).replace(/\/$/, "");
}

export function companyUrl(env) {
  return String(env.COMPANY_URL || "https://dvtechnologies.xyz").replace(/\/$/, "");
}

export function companyName(env) {
  return String(env.COMPANY_NAME || "DV Technologies").trim() || "DV Technologies";
}

export function ownerHandle(env) {
  return String(env.TELEGRAM_OWNER_USERNAME || OWNER).replace(/^@/, "");
}

export function channelUsername(env) {
  return String(env.TELEGRAM_CHANNEL_USERNAME || "DTDMAINSTORE").replace(/^@/, "");
}

export function botUsername(env) {
  return String(env.TELEGRAM_BOT_USERNAME || "Dtdpaymentbot").replace(/^@/, "");
}

export function isAdmin(env, chatId) {
  return String(chatId) === String(env.TELEGRAM_ADMIN_CHAT_ID || "");
}

export function autoApproveJoinsEnabled(env) {
  const raw = String(env.TELEGRAM_AUTO_APPROVE_JOINS ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function channelMirrorEnabled(env) {
  const raw = String(env.TELEGRAM_CHANNEL_MIRROR ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function mirrorSourceIds(env) {
  // Prefer explicit source list; do not treat destination channel as a source.
  const explicit = [
    env.TELEGRAM_MIRROR_FROM_CHANNEL_ID,
    ...(String(env.MIRROR_SOURCE_CHANNELS || "").split(/[\s,]+/))
  ]
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  const sources = explicit.length
    ? explicit
    : [env.TELEGRAM_CHANNEL_ID, env.TELEGRAM_BACKUP_CHANNEL_ID].filter(Boolean);

  const target = mirrorTargetId(env);
  return [...new Set(sources.map(String).filter((id) => id && id !== target))];
}

export function mirrorTargetId(env) {
  return String(
    env.TELEGRAM_MIRROR_TO_CHAT_ID || env.MIRROR_DEST_CHANNEL || env.TELEGRAM_GROUP_ID || ""
  ).trim();
}

export const BOT_COMMANDS = [
  { command: "start", description: "Welcome + store links" },
  { command: "help", description: "List all bot commands" },
  { command: "store", description: "Official website link" },
  { command: "products", description: "Live products from the store DB" },
  { command: "pay", description: "Paystack + Bitcoin payment info" },
  { command: "order", description: "Track order: /order <id> <email>" },
  { command: "channel", description: "Main Telegram channel" },
  { command: "support", description: "Contact @davetheedev" },
  { command: "status", description: "Admin: system status" },
  { command: "orders", description: "Admin: recent orders" },
  { command: "post", description: "Admin: post text to channels" },
  { command: "config", description: "Admin: public config summary" },
  { command: "autojoin", description: "Admin: auto-approve join requests on/off" },
  { command: "mods", description: "Admin: required bot admin permissions" },
  { command: "mirror", description: "Admin: channel→group mirror status" }
];

function storeKeyboard(env) {
  const store = storeUrl(env);
  const company = companyUrl(env);
  const channel = channelUsername(env);
  const bot = botUsername(env);
  const owner = ownerHandle(env);
  return {
    inline_keyboard: [
      [{ text: "🛒 Open store", url: store }],
      [{ text: "🌐 DV Technologies", url: company }],
      [
        { text: "📢 Channel", url: `https://t.me/${channel}` },
        { text: "💬 Support", url: `https://t.me/${owner}` }
      ],
      [{ text: "🤖 Bot menu", url: `https://t.me/${bot}?start=help` }]
    ]
  };
}

function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function listProducts(env, getSupabase) {
  const fallback = [
    { name: "Automation Bot Builder", price_usd: 49, description: "Workflow bots and order notifications." },
    { name: "Customer Support Bot", price_usd: 79, description: "FAQ intake and handoff package." },
    { name: "Analytics Dashboard Kit", price_usd: 129, description: "Sales and order tracking kit." }
  ];

  try {
    const supabase = getSupabase(env);
    if (!supabase) return fallback;
    const { data, error } = await supabase
      .from("products")
      .select("name,description,price_usd,active")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data?.length) return fallback;
    return data;
  } catch {
    return fallback;
  }
}

async function listOrders(env, getSupabase) {
  const supabase = getSupabase(env);
  if (!supabase) return { error: "Supabase not configured." };
  const { data, error } = await supabase
    .from("orders")
    .select("id,customer_name,payment_method,payment_status,total_usd,created_at")
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) return { error: error.message };
  return { orders: data || [] };
}

function helpText(admin) {
  const lines = [
    "<b>DTD Store bot commands</b>",
    "",
    "/start — welcome",
    "/store — website link",
    "/products — live catalog",
    "/pay — Paystack + BTC",
    "/order &lt;id&gt; &lt;email&gt; — track order",
    "/channel — main channel",
    "/support — contact owner",
    "/help — this list"
  ];
  if (admin) {
    lines.push(
      "",
      "<b>Admin</b>",
      "/status — integrations health",
      "/orders — latest orders",
      "/post your message — send to channels",
      "/config — public IDs + links",
      "/autojoin on|off — auto-approve join requests",
      "/mods — bot admin permissions checklist",
      "/mirror — channel→group auto-forward status"
    );
  }
  return lines.join("\n");
}

export async function handleBotCommand(env, { text, chatId, from }, deps) {
  const { getSupabase, sendTelegram } = deps;
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return null;

  const [cmdPart, ...rest] = raw.split(/\s+/);
  const command = cmdPart.split("@")[0].slice(1).toLowerCase();
  const arg = rest.join(" ").trim();
  const admin = isAdmin(env, chatId);
  const store = storeUrl(env);
  const company = companyUrl(env);
  const companyLabel = companyName(env);
  const owner = ownerHandle(env);
  const channel = channelUsername(env);
  const bot = botUsername(env);

  let reply = "";
  let replyMarkup = null;

  switch (command) {
    case "start":
      reply = [
        "<b>Welcome to DTD Store</b>",
        "",
        "Digital products · Paystack (KES) · Bitcoin",
        `Supported internationally by <b>${esc(companyLabel)}</b>`,
        "",
        `🛒 Shop: ${store}`,
        `🌐 Company: ${company}`,
        `📢 Channel: https://t.me/${channel}`,
        `🤖 Bot: @${bot}`,
        `👤 Owner: @${owner}`,
        "",
        "Tap a button below, or try /products /pay /order /help"
      ].join("\n");
      replyMarkup = storeKeyboard(env);
      break;

    case "help":
      reply = helpText(admin);
      replyMarkup = storeKeyboard(env);
      break;

    case "store":
      reply = [
        "<b>Official DTD website</b>",
        store,
        "",
        `Questions? @${owner}`
      ].join("\n");
      replyMarkup = storeKeyboard(env);
      break;

    case "channel":
      reply = [
        "<b>Main channel</b>",
        `https://t.me/${channel}`,
        `Backup / support: @${owner}`,
        `Store: ${store}`
      ].join("\n");
      replyMarkup = storeKeyboard(env);
      break;

    case "support":
      reply = [
        "<b>Support</b>",
        `Message @${owner} for orders, delivery, or complaints.`,
        `Store: ${store}`,
        `Channel: https://t.me/${channel}`
      ].join("\n");
      replyMarkup = storeKeyboard(env);
      break;

    case "pay":
      reply = [
        "<b>Payment options</b>",
        "",
        "💳 <b>Paystack</b> — card / bank / mobile money (instant checkout on the website)",
        "₿ <b>Bitcoin (BTC)</b> — pay via QR on checkout, then admin confirms",
        "",
        `Open checkout: ${store}/#checkout`,
        `Track order: /order &lt;id&gt; &lt;email&gt;`,
        `Need help? @${owner}`
      ].join("\n");
      replyMarkup = storeKeyboard(env);
      break;

    case "order": {
      const parts = rest.filter(Boolean);
      const orderId = parts[0] || "";
      const email = parts[1] || "";
      if (!orderId || !email) {
        reply = [
          "<b>Track an order</b>",
          "Usage: <code>/order ORDER_ID email@example.com</code>",
          "",
          `Or website tracker: ${store}/#track`
        ].join("\n");
        break;
      }
      try {
        const supabase = getSupabase(env);
        if (!supabase) {
          reply = `Order lookup unavailable. Message @${owner}`;
          break;
        }
        const { data, error } = await supabase
          .from("orders")
          .select("id,status,payment_method,payment_status,total_usd,created_at,customer_email")
          .eq("id", orderId)
          .maybeSingle();
        if (error || !data) {
          reply = "Order not found. Check the ID and try again.";
          break;
        }
        const emailOk =
          String(data.customer_email || data.customer_phone || "")
            .trim()
            .toLowerCase() === email.trim().toLowerCase();
        if (!emailOk) {
          reply = "Email does not match this order.";
          break;
        }
        reply = [
          "<b>Order status</b>",
          `ID: <code>${esc(data.id)}</code>`,
          `Status: <b>${esc(data.status || data.payment_status || "pending")}</b>`,
          `Payment: ${esc(data.payment_method || "n/a")}`,
          `Total: $${Number(data.total_usd || 0).toFixed(2)}`,
          `Created: ${esc(data.created_at || "")}`,
          "",
          `Support: @${owner}`
        ].join("\n");
      } catch {
        reply = `Could not look up order. Contact @${owner}`;
      }
      break;
    }

    case "products": {
      const products = await listProducts(env, getSupabase);
      reply = [
        "<b>Live products</b>",
        ...products.map(
          (p, i) =>
            `${i + 1}. <b>${esc(p.name)}</b> — $${Number(p.price_usd || 0).toFixed(2)}\n${esc(p.description || "")}`
        ),
        "",
        `Buy here: ${store}`,
        `Support: @${owner}`
      ].join("\n");
      replyMarkup = storeKeyboard(env);
      break;
    }

    case "status":
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      reply = [
        "<b>System status</b>",
        `Store: ${store}`,
        `Paystack key: ${env.PAYSTACK_PUBLIC_KEY ? "yes" : "missing"}`,
        `Paystack currency: ${env.PAYSTACK_CURRENCY || "KES"}`,
        `Supabase: ${env.SUPABASE_URL ? "yes" : "missing"}`,
        `Main channel: ${env.TELEGRAM_CHANNEL_ID || "missing"}`,
        `Backup channel: ${env.TELEGRAM_BACKUP_CHANNEL_ID || "none"}`,
        `Group: ${env.TELEGRAM_GROUP_ID || "none"}`,
        `Auto-approve joins: ${autoApproveJoinsEnabled(env) ? "ON" : "OFF"}`,
        `Owner: @${owner}`
      ].join("\n");
      break;

    case "config":
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      reply = [
        "<b>Public config</b>",
        `STORE_URL=${store}`,
        `BOT=@${bot}`,
        `CHANNEL=@${channel} (${env.TELEGRAM_CHANNEL_ID || "?"})`,
        `BACKUP=${env.TELEGRAM_BACKUP_CHANNEL_ID || "none"}`,
        `OWNER=@${owner}`,
        `ADMIN_CHAT=${env.TELEGRAM_ADMIN_CHAT_ID || "?"}`
      ].join("\n");
      break;

    case "orders": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      const result = await listOrders(env, getSupabase);
      if (result.error) {
        reply = `Could not load orders: ${esc(result.error)}`;
        break;
      }
      if (!result.orders.length) {
        reply = "No orders yet.";
        break;
      }
      reply = [
        "<b>Recent orders</b>",
        ...result.orders.map(
          (o) =>
            `• <code>${esc(o.id)}</code> ${esc(o.customer_name)} — $${Number(o.total_usd || 0).toFixed(2)} — ${esc(o.payment_method)} / ${esc(o.payment_status || "pending")}`
        )
      ].join("\n");
      break;
    }

    case "post": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      if (!arg) {
        reply = "Usage: /post Your announcement text";
        break;
      }
      const message = `${arg}\n\n🛒 ${store}\n👤 @${owner}`;
      const targets = [
        env.TELEGRAM_CHANNEL_ID,
        env.TELEGRAM_BACKUP_CHANNEL_ID,
        env.TELEGRAM_GROUP_ID
      ].filter((id, i, arr) => id && arr.indexOf(id) === i);
      let sent = 0;
      for (const target of targets) {
        const result = await sendTelegram(env, target, message);
        if (result.ok) sent += 1;
      }
      reply = sent
        ? `Posted to ${sent} channel(s).`
        : "Post failed. Check bot admin rights on the channel(s).";
      break;
    }

    case "autojoin": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      const mode = arg.toLowerCase();
      if (mode === "on" || mode === "off") {
        reply = [
          `<b>Auto-approve joins</b>`,
          `Requested: <b>${mode.toUpperCase()}</b>`,
          "",
          "To persist this, set in Cloudflare / .env:",
          `<code>TELEGRAM_AUTO_APPROVE_JOINS=${mode === "on" ? "true" : "false"}</code>`,
          "Then redeploy.",
          "",
          `Current runtime value: <b>${autoApproveJoinsEnabled(env) ? "ON" : "OFF"}</b>`
        ].join("\n");
      } else {
        reply = [
          `<b>Auto-approve joins:</b> ${autoApproveJoinsEnabled(env) ? "ON" : "OFF"}`,
          "",
          "Usage: /autojoin on   or   /autojoin off",
          "Bot must be channel/group admin with <b>Invite Users</b> permission.",
          "Enable “Approve new members” / join requests on the channel or group."
        ].join("\n");
      }
      break;
    }

    case "mods": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      reply = [
        "<b>Channel / group bot setup</b>",
        "",
        `1. Add <b>@${bot}</b> as admin`,
        "2. Enable permissions:",
        "   • Post messages",
        "   • Invite users via link (needed to auto-accept joins)",
        "   • Manage invite links (optional)",
        "3. Turn on join requests / Approve new members",
        "4. Optional co-admin: @davistechbot (manual human backup)",
        "",
        `Owner contact: @${owner}`,
        `Store: ${store}`,
        `Auto-approve: ${autoApproveJoinsEnabled(env) ? "ON" : "OFF"}`,
        `Channel→group mirror: ${channelMirrorEnabled(env) ? "ON" : "OFF"}`
      ].join("\n");
      break;
    }

    case "mirror": {
      if (!admin) {
        reply = "Admin only. Contact @" + owner;
        break;
      }
      const sources = mirrorSourceIds(env);
      const target = mirrorTargetId(env);
      reply = [
        "<b>Channel → group mirror</b>",
        `Status: <b>${channelMirrorEnabled(env) ? "ON" : "OFF"}</b>`,
        `From channel(s): ${sources.map((id) => `<code>${esc(id)}</code>`).join(", ") || "none"}`,
        `To group: <code>${esc(target) || "missing TELEGRAM_GROUP_ID"}</code>`,
        `Bot: @${bot}`,
        "",
        "Requirements:",
        `1. @${bot} admin in the SOURCE channel (so it receives posts)`,
        `2. @${bot} can post in the TARGET group`,
        "3. Env TELEGRAM_CHANNEL_MIRROR=true",
        "",
        "Note: @Realdialer / 7402702663 is a <b>user</b> ID, not a channel.",
        "If mirroring a different channel, send its -100… ID."
      ].join("\n");
      break;
    }

    default:
      reply = `Unknown command. Try /help\nStore: ${store}\nSupport: @${owner}`;
  }

  if (!reply) return null;
  if (replyMarkup) return { text: reply, reply_markup: replyMarkup };
  return reply;
}

async function telegramApi(env, method, body) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "missing_token" };
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return response.json();
}

async function handleJoinRequest(env, request, deps) {
  if (!autoApproveJoinsEnabled(env)) {
    return { handled: true, approved: false, reason: "disabled" };
  }

  const chatId = request.chat?.id;
  const userId = request.from?.id;
  if (!chatId || !userId) return { handled: false };

  const result = await telegramApi(env, "approveChatJoinRequest", {
    chat_id: chatId,
    user_id: userId
  });

  const store = storeUrl(env);
  const owner = ownerHandle(env);
  const name = [request.from?.first_name, request.from?.last_name].filter(Boolean).join(" ") || "there";

  if (result.ok) {
    // Soft welcome DM (ignore failure if user hasn't started the bot)
    await telegramApi(env, "sendMessage", {
      chat_id: userId,
      text: [
        `<b>Welcome to DTD, ${esc(name)}!</b>`,
        "",
        "You're in. Shop digital products here:",
        store,
        "",
        `Support: @${owner}`,
        "Bot help: /start"
      ].join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true
    }).catch(() => {});

    if (env.TELEGRAM_ADMIN_CHAT_ID) {
      await deps.sendTelegram(
        env,
        env.TELEGRAM_ADMIN_CHAT_ID,
        [
          "<b>Join approved</b>",
          `User: ${esc(name)} (@${esc(request.from?.username || "n/a")})`,
          `Chat: <code>${chatId}</code>`
        ].join("\n")
      );
    }
  }

  return { handled: true, approved: Boolean(result.ok), error: result.description };
}

async function handleChannelPost(env, post) {
  if (!channelMirrorEnabled(env) || !post?.chat?.id || !post.message_id) {
    return { handled: false };
  }

  const sourceId = String(post.chat.id);
  const sources = mirrorSourceIds(env);
  if (!sources.includes(sourceId)) {
    return { handled: false, reason: "source_not_configured" };
  }

  const target = mirrorTargetId(env);
  if (!target) return { handled: false, reason: "missing_target" };
  if (String(target) === sourceId) return { handled: false, reason: "same_chat" };

  // Prefer copy so the group gets a clean post; fall back to forward.
  let result = await telegramApi(env, "copyMessage", {
    chat_id: target,
    from_chat_id: sourceId,
    message_id: post.message_id
  });

  if (!result.ok) {
    result = await telegramApi(env, "forwardMessage", {
      chat_id: target,
      from_chat_id: sourceId,
      message_id: post.message_id
    });
  }

  return {
    handled: true,
    mirrored: Boolean(result.ok),
    error: result.ok ? undefined : result.description
  };
}

async function handleNewMembers(env, message, deps) {
  const members = message.new_chat_members || [];
  if (!members.length) return { handled: false };

  const store = storeUrl(env);
  const owner = ownerHandle(env);
  const bot = botUsername(env);
  const names = members
    .filter((m) => !m.is_bot)
    .map((m) => m.username ? `@${m.username}` : m.first_name)
    .filter(Boolean);

  if (!names.length) return { handled: true };

  await deps.sendTelegram(
    env,
    message.chat.id,
    [
      `<b>Welcome ${esc(names.join(", "))}!</b>`,
      "",
      `🛒 Store: ${store}`,
      `🤖 Help: @${bot} → /start`,
      `👤 Support: @${owner}`
    ].join("\n")
  );

  return { handled: true };
}

export async function processTelegramUpdate(env, update, deps) {
  if (update.chat_join_request) {
    return handleJoinRequest(env, update.chat_join_request, deps);
  }

  if (update.channel_post || update.edited_channel_post) {
    return handleChannelPost(env, update.channel_post || update.edited_channel_post);
  }

  const message = update.message || update.edited_message;
  if (!message?.chat?.id) return { handled: false };

  if (message.new_chat_members?.length) {
    await handleNewMembers(env, message, deps);
  }

  if (!message.text) return { handled: Boolean(message.new_chat_members?.length) };

  const reply = await handleBotCommand(
    env,
    {
      text: message.text,
      chatId: message.chat.id,
      from: message.from
    },
    deps
  );

  if (!reply) return { handled: false };

  if (typeof reply === "object" && reply.text) {
    await deps.sendTelegram(env, message.chat.id, reply.text, {
      reply_markup: reply.reply_markup
    });
  } else {
    await deps.sendTelegram(env, message.chat.id, reply);
  }
  return { handled: true };
}
