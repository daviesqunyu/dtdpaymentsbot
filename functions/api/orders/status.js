import { getSupabase, json } from "../../lib/store.js";

const STATUS_LABELS = {
  new: "Order received",
  confirmed: "Confirmed",
  delivered: "Delivered",
  cancelled: "Cancelled",
  pending: "Payment pending",
  paid: "Paid",
  failed: "Payment failed",
  refunded: "Refunded"
};

function labelFor(value) {
  const key = String(value || "").toLowerCase();
  return STATUS_LABELS[key] || String(value || "Unknown");
}

export async function onRequestGet(context) {
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const orderId = String(url.searchParams.get("orderId") || "").trim();
    const email = String(url.searchParams.get("email") || "").trim().toLowerCase();

    if (!orderId || !email) {
      return json({ error: "Provide orderId and email." }, 400);
    }

    const supabase = getSupabase(env);
    if (!supabase) {
      return json({ error: "Order lookup unavailable." }, 503);
    }

    const { data, error } = await supabase
      .from("orders")
      .select(
        "id,order_status,payment_method,payment_status,total_usd,created_at,customer_email,customer_phone,customer_name"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (error) return json({ error: "Could not look up that order." }, 500);
    if (!data) return json({ error: "Order not found." }, 404);

    const storedEmail = String(data.customer_email || data.customer_phone || "")
      .trim()
      .toLowerCase();
    if (storedEmail !== email) {
      return json({ error: "Email does not match this order." }, 403);
    }

    const orderStatus = data.order_status || "new";
    const paymentStatus = data.payment_status || "pending";

    return json({
      ok: true,
      order: {
        id: data.id,
        status: orderStatus,
        statusLabel: labelFor(orderStatus),
        paymentStatus,
        paymentStatusLabel: labelFor(paymentStatus),
        paymentMethod: data.payment_method,
        totalUsd: Number(data.total_usd || 0),
        createdAt: data.created_at,
        customerName: data.customer_name,
        summary: `${labelFor(orderStatus)} · ${labelFor(paymentStatus)} · $${Number(data.total_usd || 0).toFixed(2)}`
      }
    });
  } catch {
    return json({ error: "Lookup failed." }, 500);
  }
}
