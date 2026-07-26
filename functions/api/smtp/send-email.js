/**
 * Bulk email: prefer Cloudflare Email Sending (inbox works without VPS SPF),
 * else queue to VPS Postfix poller.
 * UI is To + subject + body only.
 */
import { json } from "../../lib/store.js";
import {
  createJob,
  enforceRateLimit,
  finishJob,
  getSupabaseAdmin,
  parseAddresses,
  resolveAccess,
  smtpFromAddress,
  SMTP_LIMITS
} from "../../lib/smtp.js";

const CF_BATCH = 50;

async function sendViaCfBinding(env, { from, to, subject, text }) {
  if (!env.EMAIL || typeof env.EMAIL.send !== "function") {
    return { ok: false, reason: "no_binding" };
  }
  let sent = 0;
  const errors = [];
  for (let i = 0; i < to.length; i += CF_BATCH) {
    const chunk = to.slice(i, i + CF_BATCH);
    try {
      const result = await env.EMAIL.send({
        to: chunk.length === 1 ? chunk[0] : chunk,
        from: { email: from, name: "DV Technologies" },
        replyTo: from,
        subject,
        text,
        html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
        headers: {
          "List-Unsubscribe": `<mailto:${from}?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
        }
      });
      sent += chunk.length;
      if (result?.permanent_bounces?.length) {
        errors.push(`bounces: ${result.permanent_bounces.join(", ")}`);
      }
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  if (sent === 0) return { ok: false, reason: errors.join("; ") || "cf_send_failed" };
  return { ok: true, sent, errors, via: "cloudflare_email" };
}

async function sendViaCfRest(env, { from, to, subject, text }) {
  const token = String(env.CF_EMAIL_API_TOKEN || env.CLOUDFLARE_API_TOKEN || "").trim();
  const accountId = String(env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  if (!token) return { ok: false, reason: "CF_EMAIL_API_TOKEN missing on Pages secrets" };
  if (!accountId) return { ok: false, reason: "CF_ACCOUNT_ID missing on Pages secrets" };

  let sent = 0;
  const errors = [];
  for (let i = 0; i < to.length; i += CF_BATCH) {
    const chunk = to.slice(i, i + CF_BATCH);
    let response;
    try {
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            to: chunk,
            from: { address: from, name: "DV Technologies" },
            reply_to: { address: from },
            subject,
            text,
            html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`
          })
        }
      );
    } catch (error) {
      errors.push(error.message || "fetch failed");
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      const msg =
        data?.errors?.[0]?.message ||
        data?.error ||
        `CF email HTTP ${response.status}`;
      errors.push(msg);
      continue;
    }
    const delivered = data?.result?.delivered || chunk;
    sent += Array.isArray(delivered) ? delivered.length : chunk.length;
    const bounces = data?.result?.permanent_bounces || [];
    if (bounces.length) errors.push(`bounces: ${bounces.join(", ")}`);
  }
  if (sent === 0) return { ok: false, reason: errors.join("; ") || "cf_rest_failed" };
  return { ok: true, sent, errors, via: "cloudflare_rest" };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const access = await resolveAccess(env, request);
    if (!access.ok) return json({ error: "Unlock required." }, 401);

    const rate = await enforceRateLimit(env, access, "email");
    if (!rate.ok) return json({ error: rate.reason }, 429);

    const body = await request.json().catch(() => ({}));
    const toParsed = parseAddresses(body.to || body.recipients, "email");
    const to = toParsed.valid;

    if (!to.length) {
      return json({ error: "Add at least one email address in To." }, 400);
    }
    if (to.length > SMTP_LIMITS.MAX_RECIPIENTS) {
      return json({ error: `Max ${SMTP_LIMITS.MAX_RECIPIENTS} recipients per send.` }, 400);
    }

    const subject = String(body.subject || "").trim();
    const text = String(body.text || body.body || "").trim();
    if (!subject) return json({ error: "Subject is required." }, 400);
    if (!text) return json({ error: "Message body is required." }, 400);

    const from = smtpFromAddress(env);

    const job = await createJob(env, {
      channel: "email",
      access,
      subject,
      bodyPreview: text,
      recipients: to,
      status: "sending",
      payload: { from, to, subject, text, via: "pending" }
    });
    if (!job.ok || !job.jobId) {
      return json({ error: job.reason || "Could not create job." }, 500);
    }

    // 1) Cloudflare Email Sending binding (best)
    let result = await sendViaCfBinding(env, { from, to, subject, text });
    // 2) Cloudflare REST (token secret)
    if (!result.ok) {
      result = await sendViaCfRest(env, { from, to, subject, text });
    }

    if (result.ok) {
      const status =
        result.errors?.length && result.sent < to.length ? "partial" : "sent";
      await finishJob(env, job.jobId, {
        status,
        error: result.errors?.length ? result.errors.join("; ") : null,
        recipientResults: to.map((address) => ({ address, status: "sent" }))
      });
      return json({
        ok: true,
        queued: false,
        delivered: true,
        jobId: job.jobId,
        sent: result.sent,
        via: result.via,
        message: `Delivered via Cloudflare Email (${result.sent} recipient(s)).`,
        invalid: toParsed.invalid
      });
    }

    // Fallback: queue for VPS Postfix poller (any recipient; needs SPF/DKIM for inbox).
    const sb = getSupabaseAdmin(env);
    if (sb) {
      await sb
        .from("smtp_jobs")
        .update({
          status: "queued",
          payload: {
            from,
            to,
            cc: [],
            bcc: [],
            subject,
            text,
            headers: {
              "Reply-To": from,
              "List-Unsubscribe": `<mailto:${from}?subject=unsubscribe>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
            },
            bulk: to.length >= 2,
            via: "vps_postfix"
          },
          error: null
        })
        .eq("id", job.jobId);

      return json({
        ok: true,
        queued: true,
        delivered: false,
        jobId: job.jobId,
        sent: to.length,
        via: "vps_queue",
        message: `Queued ${to.length} email(s) to VPS mailer.`,
        invalid: toParsed.invalid
      });
    }

    const reason = result.reason || "Email send failed";
    await finishJob(env, job.jobId, {
      status: "failed",
      error: reason,
      recipientResults: to.map((address) => ({ address, status: "failed", error: reason }))
    });
    return json({ error: `Email send failed: ${reason}`, jobId: job.jobId }, 502);
  } catch (error) {
    return json({ error: error.message || "Send failed." }, 500);
  }
}
