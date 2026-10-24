/**
 * DTD Store — Digital Delivery Worker
 * Consumes Redis Stream `delivery:queue`, emails digital goods via
 * multi-provider fallback (VPS Postfix -> Resend -> Brevo -> Mailgun -> CF Email),
 * then sends a Telegram receipt with Order ID + download link via Bot API.
 *
 * Run: node worker/delivery-worker.js
 */

require('dotenv').config();
const { getRedis } = require('../lib/redis/client');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const STORE_URL = process.env.STORE_URL || 'https://dtdpaymentsbot.pages.dev';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const MAX_RETRIES = 3;
const DEAD_LETTER_STREAM = 'delivery:dlq';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = {
    url: SUPABASE_URL,
    key: SUPABASE_KEY,
    async from(table) {
      return {
        async select(columns, filter) {
          let url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns}`;
          if (filter) {
            for (const [k, v] of Object.entries(filter)) {
              url += `&${k}=eq.${encodeURIComponent(v)}`;
            }
          }
          const resp = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
          return resp.json();
        },
        async update(values, filter) {
          const params = Object.entries(filter).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
          const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              Prefer: 'return=representation'
            },
            body: JSON.stringify(values)
          });
          return resp.json();
        }
      };
    }
  };
}

/** Multi-provider email fallback (mirrors _worker.js logic) */
async function sendEmailFallback({ from, to, subject, text, hostname }) {
  const providers = [];
  const errors = [];

  if (process.env.VPS_MAILER_URL) {
    providers.push({
      name: 'vps_mailer',
      send: async () => {
        const resp = await fetch(`${process.env.VPS_MAILER_URL.replace(/\/$/, '')}/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.VPS_MAILER_SECRET ? { Authorization: `Bearer ${process.env.VPS_MAILER_SECRET}` } : {})
          },
          body: JSON.stringify({ from, to, subject, text, hostname })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `VPS mailer ${resp.status}`);
        return { provider: 'vps_mailer', delivered: true, message: data.message || 'Sent via VPS mailer' };
      }
    });
  }
  if (process.env.RESEND_API_KEY) {
    providers.push({
      name: 'resend',
      send: async () => {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from,
            to: Array.isArray(to) ? to : [to],
            subject,
            text,
            html: text.replace(/\n/g, '<br>')
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.message || `Resend ${resp.status}`);
        return { provider: 'resend', delivered: true, message: 'Sent via Resend' };
      }
    });
  }
  if (process.env.BREVO_API_KEY) {
    providers.push({
      name: 'brevo',
      send: async () => {
        const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json',
            accept: 'application/json'
          },
          body: JSON.stringify({
            sender: { email: from },
            to: (Array.isArray(to) ? to : [to]).map(email => ({ email })),
            subject,
            htmlContent: text.replace(/\n/g, '<br>'),
            textContent: text
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.message || `Brevo ${resp.status}`);
        return { provider: 'brevo', delivered: true, message: 'Sent via Brevo' };
      }
    });
  }

  if (!providers.length) throw new Error('No email providers configured.');

  for (const provider of providers) {
    try {
      const result = await provider.send();
      return { ...result, attempted: providers.map(p => p.name), errors };
    } catch (err) {
      errors.push({ provider: provider.name, error: err.message });
      console.error(`Email provider ${provider.name} failed:`, err.message);
    }
  }
  throw new Error(`All email providers failed: ${errors.map(e => `${e.provider}: ${e.error}`).join('; ')}`);
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return { ok: false, reason: 'not_configured' };
  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  return resp.ok ? { ok: true } : { ok: false, reason: `telegram_${resp.status}` };
}

async function processDeliveryJob(jobId, fields) {
  const { order_id, user_id, telegram_id, email } = fields;
  const retries = Number(fields.retries || 0);

  console.log(`[delivery] Processing order ${order_id} for user ${user_id}`);

  if (!supabase) {
    throw new Error('Supabase not configured.');
  }

  // 1. Fetch order + items
  const { data: orderRows, error: orderErr } = await supabase.from('orders').select('*, order_items(*)').eq('id', order_id).single();
  if (orderErr || !orderRows) throw new Error(`Order not found: ${order_id}`);
  const order = orderRows;

  // 2. Fetch user email fallback
  const buyerEmail = email || order.customer_email || order.email;
  if (!buyerEmail) throw new Error('No buyer email on order.');

  // 3. Build delivery message
  const itemLines = (order.order_items || []).map(i => `• ${i.product_name} x${i.quantity}`).join('\n') || '• Digital item';
  const downloadLink = `${STORE_URL}/download?order=${order.id}&email=${encodeURIComponent(buyerEmail)}`;

  const emailBody = [
    `DTD Store — Order Confirmation`,
    ``,
    `Order ID: ${order.id}`,
    `Amount Paid: $${Number(order.amount_paid || order.total_usd || 0).toFixed(2)} USD`,
    `Payment Method: ${order.payment_method}`,
    ``,
    `Items:`,
    itemLines,
    ``,
    `Your digital download link:`,
    downloadLink,
    ``,
    `This link expires in 24 hours. Save your Order ID: ${order.id}`,
    ``,
    `Support: ${process.env.SUPPORT_EMAIL || 'contact@dvtechnologies.xyz'}`,
    `Telegram: @${process.env.TELEGRAM_OWNER_USERNAME || 'Davetheedev'}`
  ].join('\n');

  // 4. Send email
  let emailResult;
  try {
    emailResult = await sendEmailFallback({
      from: process.env.MAIL_FROM || 'contact@dvtechnologies.xyz',
      to: buyerEmail,
      subject: `DTD Store — Order #${String(order.id).slice(0, 8)} Delivered`,
      text: emailBody,
      hostname: process.env.MAIL_HOSTNAME || 'mail.dvtechnologies.xyz'
    });
    console.log(`[delivery] Email sent to ${buyerEmail} via ${emailResult.provider}`);
  } catch (err) {
    console.error(`[delivery] Email failed for order ${order_id}:`, err.message);
    throw err; // trigger retry
  }

  // 5. Send Telegram receipt to buyer (if telegram_id)
  if (telegram_id) {
    const tgMessage = [
      `<b>✅ Payment Confirmed — DTD Store</b>`,
      ``,
      `🔖 Order ID: <code>${String(order.id).slice(0, 12)}</code>`,
      `💵 Amount: <b>$${Number(order.amount_paid || order.total_usd || 0).toFixed(2)} USD</b>`,
      `📧 Receipt sent to: <code>${buyerEmail}</code>`,
      `🔗 Download: ${downloadLink}`,
      ``,
      `Save your Order ID for support: <code>${order.id}</code>`
    ].join('\n');
    await sendTelegramMessage(telegram_id, tgMessage);
  }

  // 6. Notify admin channel
  if (TELEGRAM_ADMIN_CHAT_ID) {
    const adminMsg = [
      `<b>📦 Order Delivered</b>`,
      `Order: <code>${String(order.id).slice(0, 8)}</code>`,
      `Buyer: ${buyerEmail}`,
      `Items: ${(order.order_items || []).length}`,
      `Via: ${emailResult.provider}`
    ].join('\n');
    await sendTelegramMessage(TELEGRAM_ADMIN_CHAT_ID, adminMsg).catch(() => {});
  }

  // 7. Mark order delivered
  try {
    await supabase.from('orders').update({
      order_status: 'delivered',
      delivered_at: new Date().toISOString()
    }).eq('id', order_id);
  } catch (err) {
    console.warn(`[delivery] Failed to mark order ${order_id} delivered:`, err.message);
  }

  console.log(`[delivery] Order ${order_id} fully delivered.`);
}

async function main() {
  const redis = getRedis();
  const stream = 'delivery:queue';
  const group = 'delivery_workers';
  const consumer = `worker-${process.pid}`;

  // Ensure consumer group exists
  try {
    await redis.xgroupCreate(stream, group, '$', true);
  } catch { /* group may exist */ }

  console.log('[delivery] Worker started. Listening on stream:', stream);

  while (true) {
    try {
      const readings = await redis.xreadgroup(group, consumer, { [stream]: '>' }, 10, 5000);
      // readings format: [[stream, [[id, fields], ...]]]
      for (const [streamName, messages] of readings) {
        for (const [id, fields] of messages) {
          try {
            await processDeliveryJob(id, fields);
            await redis.xack(stream, group, id);
          } catch (err) {
            const retries = Number(fields.retries || 0) + 1;
            console.error(`[delivery] Job ${id} failed (attempt ${retries}):`, err.message);
            if (retries >= MAX_RETRIES) {
              // Dead letter
              await redis.xadd(DEAD_LETTER_STREAM, '*',
                'original_id', id,
                'stream', stream,
                'error', err.message,
                'fields', JSON.stringify(fields),
                'failed_at', new Date().toISOString());
              await redis.xack(stream, group, id);
              console.error(`[delivery] Job ${id} moved to dead letter queue.`);
            } else {
              // Re-add with incremented retry after backoff
              await new Promise(r => setTimeout(r, 1000 * retries));
              await redis.xadd(stream, '*', ...Object.entries(fields).flat(), 'retries', String(retries));
              await redis.xack(stream, group, id);
            }
          }
        }
      }
    } catch (err) {
      console.error('[delivery] Read error:', err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

main().catch(err => {
  console.error('[delivery] Fatal:', err);
  process.exit(1);
});
