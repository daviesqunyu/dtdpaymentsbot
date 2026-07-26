import { json } from "../../lib/store.js";
import { listJobs, resolveAccess, SMTP_LIMITS, smtpFromAddress, smtpFromPhone, mailerConfigured } from "../../lib/smtp.js";

export async function onRequestGet(context) {
  try {
    const { env, request } = context;
    const access = await resolveAccess(env, request);
    if (!access.ok) return json({ error: "Unlock required." }, 401);

    const jobs = await listJobs(env, access, 40);
    const fromPhone = smtpFromPhone(env);
    return json({
      ok: true,
      role: access.role,
      from: smtpFromAddress(env),
      fromPhone,
      limits: SMTP_LIMITS,
      smsConfigured: Boolean(fromPhone),
      mailerConfigured: mailerConfigured(env),
      jobs
    });
  } catch (error) {
    return json({ error: error.message || "Lookup failed." }, 500);
  }
}
