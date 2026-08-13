#!/usr/bin/env bash
# Verify Postfix / OpenDKIM / mailer health on the VPS (run as root).
set -euo pipefail

DOMAIN="${MAIL_DOMAIN:-dvtechnologies.xyz}"
HOSTNAME_FQDN="${MAIL_HOSTNAME:-mail.${DOMAIN}}"
INSTALL_DIR="${INSTALL_DIR:-/opt/dtd-mailer}"

echo "== services =="
systemctl is-active postfix opendkim dovecot dtd-vps-mailer || true

echo "== postfix check =="
postfix check && echo OK

echo "== key postconf =="
postconf myhostname mydomain inet_interfaces mynetworks smtpd_recipient_restrictions \
  smtp_destination_concurrency_limit smtp_destination_rate_delay \
  smtpd_milters non_smtpd_milters smtp_tls_security_level

echo "== opendkim key =="
ls -la "/etc/opendkim/keys/${DOMAIN}/" 2>/dev/null || echo "missing DKIM keys"

echo "== mailer health =="
curl -fsS http://127.0.0.1:8787/health || echo "mailer not responding"

echo "== open-relay stance =="
echo "inet_interfaces=$(postconf -h inet_interfaces)"
echo "Public 25/587 should be CLOSED in ufw; only localhost submission is enabled."
ufw status 2>/dev/null | head -n 30 || true

echo "== DNS artifact =="
[[ -f "${INSTALL_DIR}/DNS_RECORDS.txt" ]] && head -n 20 "${INSTALL_DIR}/DNS_RECORDS.txt"

echo "[ok] verify finished — still publish SPF/DKIM/DMARC/PTR and run mail-tester before volume"
