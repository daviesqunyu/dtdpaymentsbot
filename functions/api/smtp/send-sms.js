/**
 * Queue real carrier SMS via SMSGate (phone SIM) on the VPS.
 * Telethon cannot send carrier SMS — gateway credentials are required.
 */
import { json } from "../../lib/store.js";
import { sendTelegram } from "../../lib/store.js";
import {
  createJob,
  enforceRateLimit,
  parseAddresses,
  resolveAccess,
  smtpFromPhone,
  SMTP_LIMITS
} from "../../lib/smtp.js";

const DEFAULT_SMSGATE = "https://api.sms-gate.app/3rdparty/v1/messages";

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const access = await resolveAccess(env, request);
    if (!access.ok) return json({ error: "Unlock required." }, 401);

    const rate = await enforceRateLimit(env, access, "sms");
    if (!rate.ok) return json({ error: rate.reason }, 429);

    const body = await request.json().catch(() => ({}));
    const parsed = parseAddresses(body.to || body.phones || body.targets, "sms");
    const text = String(body.text || body.message || "").trim();

    if (!parsed.valid.length) {
      return json(
        {
          error:
            "No usable phone numbers. Paste one per line (0712… or +254712…). Invalid: " +
            (parsed.invalid.slice(0, 5).join(", ") || "none")
        },
        400
      );
    }
    if (!text) return json({ error: "Message is required." }, 400);
    if (text.length > 1000) return json({ error: "Message too long (max 1000)." }, 400);

    const gwUser = String(body.gwUser || body.smsUser || env.SMS_GATEWAY_USER || "").trim();
    const gwPass = String(
      body.gwPass || body.smsPass || env.SMS_GATEWAY_PASS || env.SMS_GATEWAY_TOKEN || ""
    ).trim();
    const gwUrl = String(body.gwUrl || body.smsUrl || env.SMS_GATEWAY_URL || DEFAULT_SMSGATE)
      .trim()
      .replace(/\/$/, "");

    if (!gwUser || !gwPass) {
      return json(
        {
          error:
            "Real SMS needs SMSGate username + password. Install the free SMSGate Android app, enable Cloud mode, and paste the login here."
        },
        400
      );
    }

    const fromPhone = smtpFromPhone(env) || "SIM on SMSGate phone";
    const gateway = { url: gwUrl || DEFAULT_SMSGATE, user: gwUser, pass: gwPass };

    const job = await createJob(env, {
      channel: "sms",
      access,
      subject: null,
      bodyPreview: text,
      recipients: parsed.valid,
      payload: {
        fromPhone,
        phones: parsed.valid,
        text,
        backend: "sms",
        gateway
      }
    });
    if (!job.ok) return json({ error: job.reason }, 500);
    if (!job.jobId) return json({ error: "Could not queue SMS (database)." }, 500);

    const admin = env.TELEGRAM_ADMIN_CHAT_ID;
    if (admin && env.TELEGRAM_BOT_TOKEN) {
      const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text;
      await sendTelegram(
        env,
        admin,
        [
          "<b>SMS job queued (carrier)</b>",
          `From SIM / phone: <code>${fromPhone}</code>`,
          `Job: <code>${job.jobId}</code>`,
          `Phones: ${parsed.valid.length}`,
          `Via: SMSGate`,
          `Preview: ${preview.replace(/</g, "&lt;")}`
        ].join("\n")
      ).catch(() => {});
    }

    return json({
      ok: true,
      queued: true,
      jobId: job.jobId,
      sent: parsed.valid.length,
      fromPhone,
      invalid: parsed.invalid,
      message: `Queued ${parsed.valid.length} SMS via SMSGate (real carrier texts). Keep the Android phone online.`
    });
  } catch (error) {
    return json({ error: error.message || "SMS queue failed." }, 500);
  }
}
