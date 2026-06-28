import { json } from "../../lib/store.js";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const body = await request.json();
    const reference = String(body.reference || "").trim();

    if (!reference) return json({ error: "Missing reference." }, 400);

    const secret = env.PAYSTACK_SECRET_KEY;
    if (!secret) return json({ error: "Paystack secret key not configured." }, 500);

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );

    const payload = await response.json();
    if (!response.ok || !payload.status) {
      return json({ error: payload.message || "Verification failed." }, 400);
    }

    return json({
      ok: true,
      paid: payload.data.status === "success",
      amount: payload.data.amount,
      currency: payload.data.currency,
      reference: payload.data.reference
    });
  } catch (error) {
    console.error("Paystack verify error:", error);
    return json({ error: "Paystack verification failed." }, 500);
  }
}
