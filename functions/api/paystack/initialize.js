import { json } from "../../lib/store.js";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const body = await request.json();
    const secret = env.PAYSTACK_SECRET_KEY;
    if (!secret) return json({ error: "Paystack secret key not configured." }, 500);

    const email = String(body.email || "").trim();
    const name = String(body.name || "").trim();
    const amountUsd = Number(body.amountUsd || 0);
    if (!email || !(amountUsd > 0)) {
      return json({ error: "Email and amount are required." }, 400);
    }

    const currency = env.PAYSTACK_CURRENCY || "KES";
    const rate = Number(env.PAYSTACK_CONVERSION_RATE || 129);
    const amount = Math.round(amountUsd * rate * 100);
    const reference = String(body.reference || `DTD-${Date.now()}`);
    const origin = new URL(request.url).origin;

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
        callback_url: `${origin}/?paid=1&reference=${encodeURIComponent(reference)}`,
        metadata: {
          customer_name: name,
          amount_usd: amountUsd,
          cart_items: body.cartItems || ""
        }
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.status) {
      return json(
        {
          error: payload.message || "Could not start Paystack payment.",
          code: payload.code
        },
        400
      );
    }

    return json({
      ok: true,
      reference: payload.data.reference,
      access_code: payload.data.access_code,
      authorization_url: payload.data.authorization_url,
      currency,
      amount
    });
  } catch (error) {
    console.error("Paystack initialize error:", error);
    return json({ error: "Paystack initialize failed." }, 500);
  }
}
