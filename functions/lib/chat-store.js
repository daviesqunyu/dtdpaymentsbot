/**
 * Chat persistence — prefers dedicated tables; falls back to analytics_events
 * so the feed works before supabase-chat.sql is applied.
 */

import { getSupabase } from "./store.js";

const EVT_MSG = "dtd_chat_message";
const EVT_CLAIM = "dtd_chat_claim";
const EVT_LIKE = "dtd_chat_like";

function isMissingTable(err) {
  const m = String(err?.message || err || "");
  return /could not find the table|relation .* does not exist|schema cache/i.test(m);
}

export async function detectChatMode(env) {
  const supabase = getSupabase(env);
  if (!supabase) return { supabase: null, mode: "none" };
  const { error } = await supabase.from("chat_messages").select("id").limit(1);
  if (!error) return { supabase, mode: "native" };
  if (isMissingTable(error)) return { supabase, mode: "legacy" };
  return { supabase, mode: "legacy", warn: error.message };
}

export async function listMessages(env, { limit = 40, before = null, userId = null } = {}) {
  const { supabase, mode } = await detectChatMode(env);
  if (!supabase) throw new Error("Chat storage is not configured.");

  if (mode === "native") {
    let query = supabase
      .from("chat_messages")
      .select("id,telegram_username,display_name,body,likes_count,created_at,telegram_user_id")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) query = query.lt("created_at", before);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    let likedSet = new Set();
    if (userId && data?.length) {
      const { data: likes } = await supabase
        .from("chat_likes")
        .select("message_id")
        .eq("telegram_user_id", userId)
        .in(
          "message_id",
          data.map((r) => r.id)
        );
      likedSet = new Set((likes || []).map((l) => l.message_id));
    }
    return {
      mode,
      messages: (data || []).map((row) => ({
        id: row.id,
        username: row.telegram_username,
        displayName: row.display_name || row.telegram_username,
        body: row.body,
        likes: Number(row.likes_count || 0),
        liked: likedSet.has(row.id),
        createdAt: row.created_at,
        profileUrl: `https://t.me/${row.telegram_username}`
      }))
    };
  }

  // Legacy: analytics_events
  let query = supabase
    .from("analytics_events")
    .select("id,data,created_at")
    .eq("event_type", EVT_MSG)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let likedIds = new Set();
  if (userId) {
    const { data: likes } = await supabase
      .from("analytics_events")
      .select("data")
      .eq("event_type", EVT_LIKE)
      .eq("client_id", String(userId))
      .limit(500);
    likedIds = new Set((likes || []).map((l) => l.data?.messageId).filter(Boolean));
  }

  const likeCounts = {};
  const { data: allLikes } = await supabase
    .from("analytics_events")
    .select("data")
    .eq("event_type", EVT_LIKE)
    .limit(2000);
  for (const row of allLikes || []) {
    const mid = row.data?.messageId;
    if (!mid) continue;
    likeCounts[mid] = (likeCounts[mid] || 0) + 1;
  }

  return {
    mode,
    messages: (data || []).map((row) => {
      const d = row.data || {};
      return {
        id: row.id,
        username: d.username,
        displayName: d.displayName || d.username,
        body: d.body,
        likes: likeCounts[row.id] || 0,
        liked: likedIds.has(row.id),
        createdAt: row.created_at,
        profileUrl: `https://t.me/${d.username}`
      };
    })
  };
}

export async function insertMessage(env, { userId, username, displayName, body }) {
  const { supabase, mode } = await detectChatMode(env);
  if (!supabase) throw new Error("Chat storage is not configured.");

  if (mode === "native") {
    const since = new Date(Date.now() - 20_000).toISOString();
    const { data: recent } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("telegram_user_id", userId)
      .gte("created_at", since)
      .limit(1);
    if (recent?.length) throw Object.assign(new Error("Slow down — wait a few seconds between posts."), { status: 429 });

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        telegram_user_id: userId,
        telegram_username: username,
        display_name: displayName,
        body
      })
      .select("id,telegram_username,display_name,body,likes_count,created_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      mode,
      message: {
        id: data.id,
        username: data.telegram_username,
        displayName: data.display_name || data.telegram_username,
        body: data.body,
        likes: Number(data.likes_count || 0),
        liked: false,
        createdAt: data.created_at,
        profileUrl: `https://t.me/${data.telegram_username}`
      }
    };
  }

  const since = new Date(Date.now() - 20_000).toISOString();
  const { data: recent } = await supabase
    .from("analytics_events")
    .select("id")
    .eq("event_type", EVT_MSG)
    .eq("client_id", String(userId))
    .gte("created_at", since)
    .limit(1);
  if (recent?.length) throw Object.assign(new Error("Slow down — wait a few seconds between posts."), { status: 429 });

  const { data, error } = await supabase
    .from("analytics_events")
    .insert({
      client_id: String(userId),
      session_id: "chat",
      event_type: EVT_MSG,
      path: "/#chat",
      data: { username, displayName, body, telegramUserId: userId }
    })
    .select("id,data,created_at")
    .single();
  if (error) throw new Error(error.message);
  const d = data.data || {};
  return {
    mode,
    message: {
      id: data.id,
      username: d.username,
      displayName: d.displayName || d.username,
      body: d.body,
      likes: 0,
      liked: false,
      createdAt: data.created_at,
      profileUrl: `https://t.me/${d.username}`
    }
  };
}

export async function toggleLike(env, { messageId, userId }) {
  const { supabase, mode } = await detectChatMode(env);
  if (!supabase) throw new Error("Chat storage is not configured.");

  if (mode === "native") {
    const { data: existing } = await supabase
      .from("chat_likes")
      .select("message_id")
      .eq("message_id", messageId)
      .eq("telegram_user_id", userId)
      .maybeSingle();

    if (existing) {
      await supabase.from("chat_likes").delete().eq("message_id", messageId).eq("telegram_user_id", userId);
      const { data: msg } = await supabase.from("chat_messages").select("likes_count").eq("id", messageId).maybeSingle();
      const next = Math.max(0, Number(msg?.likes_count || 1) - 1);
      await supabase.from("chat_messages").update({ likes_count: next }).eq("id", messageId);
      return { liked: false, likes: next };
    }

    const { error } = await supabase.from("chat_likes").insert({
      message_id: messageId,
      telegram_user_id: userId
    });
    if (error) throw new Error(error.message);
    const { data: msg } = await supabase.from("chat_messages").select("likes_count").eq("id", messageId).maybeSingle();
    const next = Number(msg?.likes_count || 0) + 1;
    await supabase.from("chat_messages").update({ likes_count: next }).eq("id", messageId);
    return { liked: true, likes: next };
  }

  const { data: existing } = await supabase
    .from("analytics_events")
    .select("id")
    .eq("event_type", EVT_LIKE)
    .eq("client_id", String(userId))
    .contains("data", { messageId })
    .maybeSingle();

  if (existing) {
    await supabase.from("analytics_events").delete().eq("id", existing.id);
  } else {
    const { error } = await supabase.from("analytics_events").insert({
      client_id: String(userId),
      session_id: "chat",
      event_type: EVT_LIKE,
      path: "/#chat",
      data: { messageId }
    });
    if (error) throw new Error(error.message);
  }

  const { data: likes } = await supabase
    .from("analytics_events")
    .select("id")
    .eq("event_type", EVT_LIKE)
    .contains("data", { messageId });
  const count = likes?.length || 0;
  return { liked: !existing, likes: count };
}

export async function createClaim(env, code, expiresAt) {
  const { supabase, mode } = await detectChatMode(env);
  if (!supabase) throw new Error("Chat storage is not configured.");

  if (mode === "native") {
    const { error } = await supabase.from("chat_link_codes").insert({
      code,
      status: "pending",
      expires_at: expiresAt
    });
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("analytics_events").insert({
    client_id: code,
    session_id: "chat_claim",
    event_type: EVT_CLAIM,
    path: "/#chat",
    data: { code, status: "pending", expiresAt }
  });
  if (error) throw new Error(error.message);
}

export async function getClaim(env, code) {
  const { supabase, mode } = await detectChatMode(env);
  if (!supabase) throw new Error("Chat storage is not configured.");
  const clean = String(code || "")
    .trim()
    .toUpperCase();

  if (mode === "native") {
    const { data, error } = await supabase.from("chat_link_codes").select("*").eq("code", clean).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("analytics_events")
    .select("id,data,created_at")
    .eq("event_type", EVT_CLAIM)
    .eq("client_id", clean)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const d = data.data || {};
  return {
    code: clean,
    status: d.status || "pending",
    telegram_user_id: d.telegramUserId,
    telegram_username: d.telegramUsername,
    display_name: d.displayName,
    expires_at: d.expiresAt,
    _legacyId: data.id
  };
}

export async function updateClaim(env, code, patch) {
  const { supabase, mode } = await detectChatMode(env);
  if (!supabase) throw new Error("Chat storage is not configured.");
  const clean = String(code || "")
    .trim()
    .toUpperCase();

  if (mode === "native") {
    const { error } = await supabase
      .from("chat_link_codes")
      .update({
        status: patch.status,
        telegram_user_id: patch.telegram_user_id,
        telegram_username: patch.telegram_username,
        display_name: patch.display_name,
        claimed_at: patch.claimed_at
      })
      .eq("code", clean);
    if (error) throw new Error(error.message);
    return;
  }

  const row = await getClaim(env, clean);
  if (!row?._legacyId) throw new Error("Code not found.");
  const { error } = await supabase
    .from("analytics_events")
    .update({
      data: {
        code: clean,
        status: patch.status,
        telegramUserId: patch.telegram_user_id,
        telegramUsername: patch.telegram_username,
        displayName: patch.display_name,
        expiresAt: row.expires_at,
        claimedAt: patch.claimed_at
      }
    })
    .eq("id", row._legacyId);
  if (error) throw new Error(error.message);
}
