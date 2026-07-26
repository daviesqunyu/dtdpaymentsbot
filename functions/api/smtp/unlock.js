import { json } from "../../lib/store.js";
import {
  findPaidSmtpOrder,
  isAdminBearer,
  issueUnlockToken,
  smtpFromAddress,
  smtpFromPhone,
  mailerConfigured,
  SMTP_LIMITS
} from "../../lib/smtp.js";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode || "order").toLowerCase();
    const fromPhone = smtpFromPhone(env);
    const mailOk = mailerConfigured(env);

    if (mode === "admin") {
      const ok = await isAdminBearer(env, request);
      if (!ok) return json({ error: "Admin sign-in required." }, 401);
      const token = await issueUnlockToken(env, {
        role: "admin",
        email: "admin",
        orderId: null
      });
      return json({
        ok: true,
        role: "admin",
        token,
        from: smtpFromAddress(env),
        fromPhone,
        limits: SMTP_LIMITS,
        smsConfigured: Boolean(fromPhone),
        mailerConfigured: mailOk,
        mailerHost: mailOk ? "vps-postfix-poller" : null
      });
    }

    const orderId = String(body.orderId || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    if (!orderId || !email) {
      return json({ error: "Provide orderId and email." }, 400);
    }

    const check = await findPaidSmtpOrder(env, orderId, email);
    if (!check.ok) {
      const map = {
        order_not_found: "Order not found.",
        email_mismatch: "Email does not match this order.",
        not_paid: "Order is not paid yet.",
        not_smtp_product: "This order does not include the SMTP product.",
        db_unavailable: "Database unavailable."
      };
      return json({ error: map[check.reason] || check.reason || "Unlock failed." }, 403);
    }

    const token = await issueUnlockToken(env, {
      role: "buyer",
      email: check.email,
      orderId: check.orderId
    });

    return json({
      ok: true,
      role: "buyer",
      token,
      orderId: check.orderId,
      email: check.email,
      from: smtpFromAddress(env),
      fromPhone,
      limits: SMTP_LIMITS,
      smsConfigured: Boolean(fromPhone),
      mailerConfigured: mailOk
    });
  } catch (error) {
    return json({ error: error.message || "Unlock failed." }, 500);
  }
}
