/**
 * Escrow helpers — create / view / transition sessions (USDT TRC20).
 */

import { getSupabase } from "./store.js";
import { isAdminBearer } from "./smtp.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function getDepositAddress(env) {
  return String(env.ESCROW_DEPOSIT_ADDRESS || env.USDT_TRC20_ADDRESS || "").trim();
}

export function randomEscrowCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return "ESR-" + [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function normalizeTelegramHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .slice(0, 64);
}

export function normalizeAddress(value) {
  return String(value || "").trim().slice(0, 128);
}

async function addLog(supabase, sessionId, kind, actor, fields = {}) {
  try {
    await supabase.from("escrow_transactions").insert({
      session_id: sessionId,
      kind,
      actor: actor || "admin",
      amount_usd: fields.amount_usd ?? null,
      tx_hash: fields.tx_hash ?? null,
      message: fields.message ?? null
    });
  } catch {
    /* optional */
  }
}

export async function createEscrowSession(env, input) {
  const supabase = getSupabase(env);
  if (!supabase) return { ok: false, error: "Escrow storage unavailable. Run supabase-escrow.sql." };

  const title = String(input.title || "").trim().slice(0, 120);
  const amountUsd = Number(input.amountUsd || 0);
  const buyer = normalizeTelegramHandle(input.buyerTelegram);
  const seller = normalizeTelegramHandle(input.sellerTelegram);
  const depositAddress = getDepositAddress(env);

  if (!title) return { ok: false, error: "Title is required." };
  if (!(amountUsd > 0)) return { ok: false, error: "Amount (USD) is required." };
  if (!buyer) return { ok: false, error: "Buyer Telegram @username is required." };
  if (!seller) return { ok: false, error: "Seller Telegram @username is required." };
  if (!depositAddress) {
    return {
      ok: false,
      error: "Deposit address missing. Set ESCROW_DEPOSIT_ADDRESS or USDT_TRC20_ADDRESS."
    };
  }

  const payload = {
    code: randomEscrowCode(),
    title,
    description: String(input.description || "").trim().slice(0, 500) || null,
    amount_usd: amountUsd,
    currency: "USDT",
    asset: "USDT",
    network: "TRC20",
    buyer_telegram: `@${buyer}`,
    seller_telegram: `@${seller}`,
    buyer_payout_address: normalizeAddress(input.buyerPayoutAddress) || null,
    seller_payout_address: normalizeAddress(input.sellerPayoutAddress) || null,
    deposit_address: depositAddress,
    escrow_fee: Number(input.escrowFee || 0),
    status: "open",
    created_by: input.createdBy || null
  };

  const { data, error } = await supabase.from("escrow_sessions").insert(payload).select("*").single();
  if (error || !data) {
    return { ok: false, error: error?.message || "Could not create escrow." };
  }

  await addLog(supabase, data.id, "created", "admin", { amount_usd: amountUsd });
  return { ok: true, session: data };
}

export async function getEscrowByCode(env, code) {
  const supabase = getSupabase(env);
  if (!supabase) return { ok: false, error: "Escrow storage unavailable." };
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return { ok: false, error: "Missing escrow code." };

  const { data, error } = await supabase
    .from("escrow_sessions")
    .select("*")
    .eq("code", clean)
    .maybeSingle();
  if (error) return { ok: false, error: error.message || "Lookup failed." };
  if (!data) return { ok: false, error: "Escrow not found." };
  return { ok: true, session: data };
}

export async function getEscrowTransactions(env, sessionId) {
  const supabase = getSupabase(env);
  if (!supabase) return [];
  const { data } = await supabase
    .from("escrow_transactions")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  return data || [];
}

export async function getEscrowMessages(env, sessionId) {
  const supabase = getSupabase(env);
  if (!supabase) return [];
  const { data } = await supabase
    .from("escrow_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  return data || [];
}

export async function listEscrowSessions(env, { limit = 50 } = {}) {
  const supabase = getSupabase(env);
  if (!supabase) return [];
  const { data } = await supabase
    .from("escrow_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}

export async function transitionEscrow(
  env,
  sessionId,
  nextStatus,
  { actor = "admin", txHash = null, message = null, releasedAt = null } = {}
) {
  const supabase = getSupabase(env);
  if (!supabase) return { ok: false, error: "Escrow storage unavailable." };

  const patch = {
    status: nextStatus,
    proof_note: message || null,
    updated_at: new Date().toISOString()
  };
  if (releasedAt || nextStatus === "released") {
    patch.released_at = releasedAt || new Date().toISOString();
  }
  if (nextStatus === "funded") {
    patch.funded_at = new Date().toISOString();
  }
  if (txHash) patch.deposit_tx_hash = txHash;

  const { error } = await supabase.from("escrow_sessions").update(patch).eq("id", sessionId);
  if (error) return { ok: false, error: error.message || "Update failed." };

  await addLog(supabase, sessionId, nextStatus, actor, { tx_hash: txHash, message });
  return { ok: true };
}

export { isAdminBearer };
