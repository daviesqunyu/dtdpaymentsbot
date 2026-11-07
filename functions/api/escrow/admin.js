import { json } from "../../lib/store.js";
import {
  createEscrowSession,
  getDepositAddress,
  isAdminBearer,
  listEscrowSessions,
  transitionEscrow
} from "../../lib/escrow.js";

async function requireAdmin(context) {
  const { env, request } = context;
  const ok = await isAdminBearer(env, request);
  if (!ok) return json({ error: "Admin access required." }, 401);
  return null;
}

export async function onRequestPost(context) {
  try {
    const denied = await requireAdmin(context);
    if (denied) return denied;

    const { env, request } = context;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "create").toLowerCase();

    if (action === "create") {
      const result = await createEscrowSession(env, body);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true, session: result.session });
    }

    if (action === "release") {
      const result = await transitionEscrow(env, body.sessionId, "released", {
        actor: "admin",
        message: body.reason || "Released by admin."
      });
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true, released: true });
    }

    if (action === "cancel") {
      const result = await transitionEscrow(env, body.sessionId, "cancelled", {
        actor: "admin",
        message: body.reason || "Cancelled by admin."
      });
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true, cancelled: true });
    }

    if (action === "dispute") {
      const result = await transitionEscrow(env, body.sessionId, "disputed", {
        actor: "admin",
        message: body.reason || "Disputed."
      });
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true, disputed: true });
    }

    if (action === "confirm_deposit") {
      const result = await transitionEscrow(env, body.sessionId, "funded", {
        actor: "admin",
        txHash: body.txHash || null,
        message: body.note || "Deposit confirmed by admin."
      });
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true, funded: true, depositAddress: getDepositAddress(env) });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    return json({ error: error.message || "Escrow admin failed." }, 500);
  }
}

export async function onRequestGet(context) {
  try {
    const denied = await requireAdmin(context);
    if (denied) return denied;

    const { env } = context;
    const sessions = await listEscrowSessions(env);
    return json({
      ok: true,
      depositAddress: getDepositAddress(env),
      sessions
    });
  } catch (error) {
    return json({ error: error.message || "Escrow list failed." }, 500);
  }
}
