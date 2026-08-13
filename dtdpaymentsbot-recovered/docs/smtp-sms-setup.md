# SMTP + SMS console (simple)

## Flow (what you have)

```
Store #smtp
  → Cloudflare Function queues smtp_jobs in Supabase
  → VPS dtd-smtp-poller pulls jobs
       email → local mailer → AWS SES SMTP (587 STARTTLS) — primary
                  → local Postfix (25) — fallback
       sms   → SMSGate (SIM) and/or Telethon (phone on Telegram)
  → Telegram bot only notifies admin (control plane, not the SMS destination)
```

Cloudflare Workers cannot `fetch()` raw VPS IPs (error 1003). The poller is required.

## Console UI

- **Email:** To (bulk) + Subject + Body
- **SMS:** phone numbers (E.164) + message
- **History:** queued → sending → sent / failed

## AWS SES (primary, high deliverability)

Email is delivered via AWS SES SMTP (port **587**, STARTTLS) for best Gmail/Outlook placement.
Postfix is kept as a fallback only.

Required env on VPS `/opt/dtd-mailer/poller.env` and Cloudflare Pages:

| Var | Value (example) |
|-----|-----------------|
| `VPS_MAIL_MODE` | `aws_ses` |
| `SMTP_HOST` | `email-smtp.<region>.amazonaws.com` (or your mail-manager SES host) |
| `SMTP_PORT` | `587` |
| `SMTP_USERNAME` | SES SMTP username |
| `SMTP_PASSWORD` | SES SMTP password |

The Worker stores these in the `smtp_jobs.payload` and the poller forwards them to
`vps_mailer.py`, which chooses `send_via_aws_ses` (587 + STARTTLS) by default.

## Email deliverability (required DNS)

With AWS SES the domain `dvtechnologies.xyz` is verified in SES. In **Cloudflare DNS** set SPF TXT on `@`:

```txt
v=spf1 include:amazonses.com ~all
```

DKIM is published via the AWS SES console (route 53 / custom verification records →
copy the 3 CNAME DKIM records into Cloudflare DNS as `*.domainkey.dvtechnologies.xyz`).

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
