import { json } from "../../lib/store.js";
import {
  getEscrowByCode,
  getEscrowMessages,
  getEscrowTransactions
} from "../../lib/escrow.js";

export async function onRequestGet(context) {
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const code = String(url.searchParams.get("code") || "").trim();

    const result = await getEscrowByCode(env, code);
    if (!result.ok) {
      return json({ error: result.error }, result.error === "Escrow not found." ? 404 : 400);
    }

    const { session } = result;
    const transactions = await getEscrowTransactions(env, session.id);
    const messages = await getEscrowMessages(env, session.id);

    return json({
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
      transactions: transactions.map((t) => ({
        kind: t.kind,
        actor: t.actor,
        amountUsd: Number(t.amount_usd || 0),
        txHash: t.tx_hash,
        message: t.message,
        createdAt: t.created_at
      })),
      messages: messages.map((m) => ({
        author: m.author,
        body: m.body,
        createdAt: m.created_at
      }))
    });
  } catch (error) {
    return json({ error: error.message || "Could not load escrow." }, 500);
  }
}
