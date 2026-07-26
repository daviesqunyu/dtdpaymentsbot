# SMTP + SMS console (simple)

## Flow (what you have)

```
Store #smtp
  → Cloudflare Function queues smtp_jobs in Supabase
  → VPS dtd-smtp-poller pulls jobs
       email → local mailer → Postfix
       sms   → SMSGate (SIM) and/or Telethon (phone on Telegram)
  → Telegram bot only notifies admin (control plane, not the SMS destination)
```

Cloudflare Workers cannot `fetch()` raw VPS IPs (error 1003). The poller is required.

## Console UI

- **Email:** To (bulk) + Subject + Body
- **SMS:** phone numbers (E.164) + message
- **History:** queued → sending → sent / failed

## Email deliverability (required DNS)

VPS Postfix **does send**. Gmail rejects with `550-5.7.26` until SPF/DKIM authorize `185.209.229.34`.

In **Cloudflare DNS** for `dvtechnologies.xyz`, set SPF TXT on `@` to:

```txt
v=spf1 ip4:185.209.229.34 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all
```

Add DKIM TXT `mail._domainkey` from `/opt/dtd-mailer/DNS_RECORDS.txt` on the VPS.

Set Contabo **PTR** `185.209.229.34` → `mail.dvtechnologies.xyz`.

Then test with [mail-tester.com](https://www.mail-tester.com/).

## SMS backends on VPS

Env in `/opt/dtd-mailer/poller.env`:

| Var | Purpose |
|-----|---------|
| `SMS_BACKEND` | `auto` (default), `smsgate`, or `telegram` |
| `SMS_GATEWAY_*` | Real carrier SMS via [SMSGate](https://sms-gate.app/) phone app |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / Telethon session | Deliver to numbers that have Telegram |

`auto`: SMSGate if URL set, else Telethon-by-phone.

## Deploy

```bash
npm run deploy
python scripts/deploy_smtp_sms_vps.py
```

## Warm-up

New IPs: start with tens of emails/day, ramp over weeks. Do not blast on day one.
