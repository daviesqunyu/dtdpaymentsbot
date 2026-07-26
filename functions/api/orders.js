import {
  buildOrderTelegramMessage,
  dbPaymentMethod,
  insertOrder,
  json,
  normalizePaymentMethod,
  notifyOrderTelegram,
  updateOrderPayment,
  verifyPaystackPayment
} from "../lib/store.js";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const body = await request.json();
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
    } = body;

    if (!customerName || !customerEmail || !Array.isArray(items) || !items.length) {
      return json({ error: "Missing required order fields." }, 400);
    }

    const normalizedMethod = normalizePaymentMethod(paymentMethod);
    const dbMethod = dbPaymentMethod(normalizedMethod);
    const total = Number(totalUsd || 0);

    // Verify gateway / on-chain payment before the order is stored as pending.
    let paymentStatus = "pending";
    let paymentState = "not_finished";
    if (dbMethod === "Paystack" && paymentReference) {
      const verification = await verifyPaystackPayment(env, paymentReference);
      if (verification.ok) {
        paymentState = verification.state;
        if (verification.state === "complete") paymentStatus = "paid";
        else if (verification.state === "failed") paymentStatus = "failed";
      }
    } else if (dbMethod === "Crypto" && paymentReference) {
      const isUsdt = /usdt|trc20|tron/i.test(String(normalizedMethod));
      if (isUsdt && env.USDT_TRC20_ADDRESS) {
        try {
          const response = await fetch(
            `https://api.trongrid.io/v1/accounts/${encodeURIComponent(env.USDT_TRC20_ADDRESS)}/transactions/trc20?limit=80&only_to=true`,
            { headers: { Accept: "application/json" } }
          );
          if (response.ok) {
            const payload = await response.json();
            const tx = (payload.data || []).find(
              (row) => String(row.transaction_id || "").toLowerCase() === String(paymentReference).toLowerCase()
            );
            if (tx) {
              const decimals = Number(tx.token_info?.decimals ?? 6);
              const amount = Number(tx.value || 0) / 10 ** decimals;
              if (amount + 0.01 >= total) {
                paymentStatus = "paid";
                paymentState = "complete";
              }
            }
          }
        } catch {
          /* keep pending */
        }
      } else if (env.BTC_ADDRESS) {
        try {
          const response = await fetch(
            `https://blockstream.info/api/tx/${encodeURIComponent(String(paymentReference).trim())}`
          );
          if (response.ok) {
            const tx = await response.json();
            const paidSats = (tx.vout || [])
              .filter((out) => out.scriptpubkey_address === env.BTC_ADDRESS)
              .reduce((sum, out) => sum + Number(out.value || 0), 0);
            const btcPaid = paidSats / 1e8;
            let needBtc = 0;
            try {
              const spot = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
              if (spot.ok) {
                const spotJson = await spot.json();
                const rate = Number(spotJson?.data?.amount || 0);
                if (rate > 0) needBtc = total / rate;
              }
            } catch {
              /* ignore */
            }
            if (needBtc > 0 && btcPaid + 1e-8 >= needBtc * 0.98) {
              paymentStatus = "paid";
              paymentState = "complete";
            }
          }
        } catch {
          /* keep pending */
        }
      }
    }

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
      env,
      {
        customer_name: customerName,
        customer_phone: customerEmail,
        customer_email: customerEmail,
        telegram_username: telegramUsername || null,
        delivery_details: deliveryBlock,
        payment_method: dbMethod,
        payment_reference: paymentReference || null,
        product_account: productAccount || null,
        total_usd: Number(totalUsd || 0)
      },
      items
    );

    // Persist the reference + resolved payment status (works through the RPC
    // path too, which does not accept these columns directly).
    if (orderId) {
      await updateOrderPayment(env, orderId, {
        payment_reference: paymentReference || null,
        payment_status: paymentStatus
      });
    }

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
      paymentStatus,
      paymentState,
      visitorIp: visitorIp || "",
      userAgent: userAgent || ""
    });

    await notifyOrderTelegram(env, telegramMessage);

    return json({ ok: true, orderId, paymentStatus, paymentState });
  } catch (error) {
    console.error("Order error:", error);
    return json({ error: error.message || "Could not save order." }, 500);
  }
}
