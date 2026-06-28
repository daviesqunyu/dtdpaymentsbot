import {
  buildOrderTelegramMessage,
  dbPaymentMethod,
  insertOrder,
  json,
  normalizePaymentMethod,
  notifyOrderTelegram
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
      totalUsd
    } = body;

    if (!customerName || !customerEmail || !Array.isArray(items) || !items.length) {
      return json({ error: "Missing required order fields." }, 400);
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
      env,
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

    const telegramMessage = buildOrderTelegramMessage({
      customerName,
      customerEmail,
      telegramUsername,
      normalizedMethod,
      paymentReference,
      productAccount,
      totalUsd,
      items,
      orderId
    });

    await notifyOrderTelegram(env, telegramMessage);

    return json({ ok: true, orderId });
  } catch (error) {
    console.error("Order error:", error);
    return json({ error: error.message || "Could not save order." }, 500);
  }
}
