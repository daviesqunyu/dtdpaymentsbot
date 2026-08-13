#!/usr/bin/env bash
# Install + harden Postfix for DTD outbound mail (bulk-friendly) + dtd-vps-mailer.
#
# Maps the standard bulk-Postfix guide to a legal, non-relay setup:
#   Guide "app → SMTP 587 SASL"  →  Cloudflare → secret mailer API → Postfix
#   Plus optional localhost:587 SASL for on-box tools (never public).
#   Guide DNS/auth/TLS/bulk tuning/fail2ban/warmup  →  implemented below.
#
# Usage (root on VPS):
#   export VPS_MAILER_SECRET='...'
#   export MAIL_FROM='contact@dvtechnologies.xyz'
#   export MAIL_DOMAIN='dvtechnologies.xyz'
#   bash install_vps_mailer.sh
set -euo pipefail

DOMAIN="${MAIL_DOMAIN:-dvtechnologies.xyz}"
HOSTNAME_FQDN="${MAIL_HOSTNAME:-mail.${DOMAIN}}"
MAIL_FROM="${MAIL_FROM:-contact@${DOMAIN}}"
ADMIN_EMAIL="${ADMIN_EMAIL:-${MAIL_FROM}}"
SECRET="${VPS_MAILER_SECRET:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/dtd-mailer}"
DKIM_SELECTOR="${DKIM_SELECTOR:-mail}"
VPS_IP="${VPS_IP:-}"
SASL_USER="${SASL_USER:-dtdmail}"

if [[ -z "$SECRET" ]]; then
  echo "Export VPS_MAILER_SECRET first."
  exit 1
fi

if [[ -z "$VPS_IP" ]]; then
  VPS_IP="$(curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || true)"
fi
if [[ -z "$VPS_IP" ]]; then
  VPS_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  postfix mailutils \
  dovecot-core dovecot-imapd \
  opendkim opendkim-tools \
  python3 curl ca-certificates ufw fail2ban \
  certbot

# --- Hostname (guide: mail.yourdomain.com) ---
hostnamectl set-hostname "$HOSTNAME_FQDN" || true
if ! grep -qF "$HOSTNAME_FQDN" /etc/hosts 2>/dev/null; then
  echo "127.0.0.1 ${HOSTNAME_FQDN} ${DOMAIN}" >> /etc/hosts
fi
echo "$DOMAIN" > /etc/mailname

# --- Postfix Internet Site ---
debconf-set-selections <<EOF
postfix postfix/mailname string ${DOMAIN}
postfix postfix/main_mailer_type select Internet Site
EOF
dpkg-reconfigure -f noninteractive postfix || true

# Identity + anti-open-relay (guide smtpd_recipient_restrictions)
postconf -e "myhostname = ${HOSTNAME_FQDN}"
postconf -e "mydomain = ${DOMAIN}"
postconf -e "myorigin = \$mydomain"
# Public SMTP stays closed; loopback + local submission only
postconf -e "inet_interfaces = loopback-only"
postconf -e "inet_protocols = ipv4"
postconf -e "mydestination = localhost, localhost.localdomain"
postconf -e "mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128"
postconf -e "relay_domains ="
postconf -e "smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination"
postconf -e "smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination"
postconf -e "smtpd_helo_required = yes"
postconf -e "disable_vrfy_command = yes"
postconf -e "smtpd_banner = \$myhostname ESMTP"

# SASL via Dovecot (guide) — used only on localhost submission
postconf -e "smtpd_sasl_type = dovecot"
postconf -e "smtpd_sasl_path = private/auth"
postconf -e "smtpd_sasl_auth_enable = yes"
postconf -e "smtpd_sasl_security_options = noanonymous"
postconf -e "smtpd_sasl_local_domain = \$myhostname"
postconf -e "broken_sasl_auth_clients = yes"

# TLS (guide: Let's Encrypt + smtp*_tls)
postconf -e "smtp_tls_security_level = may"
postconf -e "smtpd_tls_security_level = may"
postconf -e "smtpd_tls_auth_only = yes"
postconf -e "smtp_tls_loglevel = 1"
postconf -e "smtpd_tls_received_header = yes"
postconf -e "smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt"

# Bulk / queue tuning (guide)
postconf -e "default_process_limit = 100"
postconf -e "smtp_destination_concurrency_limit = 5"
postconf -e "smtp_destination_rate_delay = 1s"
postconf -e "smtp_destination_recipient_limit = 20"
postconf -e "maximal_queue_lifetime = 2d"
postconf -e "bounce_queue_lifetime = 1d"
postconf -e "message_size_limit = 10485760"
postconf -e "mailbox_size_limit = 0"
postconf -e "default_destination_concurrency_limit = 10"

CERT_DIR="/etc/letsencrypt/live/${HOSTNAME_FQDN}"
if [[ ! -f "${CERT_DIR}/fullchain.pem" ]]; then
  echo "[info] Attempting Let's Encrypt for ${HOSTNAME_FQDN} (needs public A record + port 80)..."
  certbot certonly --standalone -d "$HOSTNAME_FQDN" \
    --non-interactive --agree-tos -m "$ADMIN_EMAIL" \
    --preferred-challenges http || echo "[warn] certbot skipped — set TLS later when DNS is ready"
fi
if [[ -f "${CERT_DIR}/fullchain.pem" ]]; then
  postconf -e "smtpd_tls_cert_file = ${CERT_DIR}/fullchain.pem"
  postconf -e "smtpd_tls_key_file = ${CERT_DIR}/privkey.pem"
  postconf -e "smtpd_use_tls = yes"
  postconf -e "smtpd_tls_security_level = may"
  echo "[ok] TLS cert loaded for ${HOSTNAME_FQDN}"
fi

# --- master.cf: submission on localhost:587 only (guide block, locked down) ---
MASTER_CF="/etc/postfix/master.cf"
# Remove prior DTD submission block if re-running
sed -i '/# DTD-LOCAL-SUBMISSION-BEGIN/,/# DTD-LOCAL-SUBMISSION-END/d' "$MASTER_CF"
cat >> "$MASTER_CF" <<'EOF'
# DTD-LOCAL-SUBMISSION-BEGIN
# Authenticated submission for local apps only (not exposed publicly)
127.0.0.1:submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_sasl_type=dovecot
  -o smtpd_sasl_path=private/auth
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING
# DTD-LOCAL-SUBMISSION-END
EOF

# --- Dovecot SASL auth socket for Postfix ---
mkdir -p /etc/dovecot/conf.d
cat > /etc/dovecot/conf.d/10-master.conf <<'EOF'
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}
EOF

cat > /etc/dovecot/conf.d/10-auth.conf <<EOF
disable_plaintext_auth = no
auth_mechanisms = plain login
!include auth-passwdfile.conf.ext
EOF

# passwd-file user (password = VPS_MAILER_SECRET) for local SMTP tools
PASS_HASH="$(doveadm pw -s SHA512-CRYPT -p "$SECRET" 2>/dev/null || openssl passwd -6 "$SECRET")"
cat > /etc/dovecot/users <<EOF
${SASL_USER}:${PASS_HASH}::::::
EOF
chmod 600 /etc/dovecot/users

# Ensure auth-passwdfile include exists
if [[ ! -f /etc/dovecot/conf.d/auth-passwdfile.conf.ext ]]; then
  cat > /etc/dovecot/conf.d/auth-passwdfile.conf.ext <<'EOF'
passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT username_format=%u /etc/dovecot/users
}
userdb {
  driver = static
  args = uid=nobody gid=nogroup home=/tmp
}
EOF
fi

systemctl enable dovecot
systemctl restart dovecot || true

# --- OpenDKIM (guide) ---
mkdir -p "/etc/opendkim/keys/${DOMAIN}"
chown -R opendkim:opendkim /etc/opendkim
chmod 750 /etc/opendkim/keys

if [[ ! -f "/etc/opendkim/keys/${DOMAIN}/${DKIM_SELECTOR}.private" ]]; then
  opendkim-genkey -b 2048 -d "$DOMAIN" -D "/etc/opendkim/keys/${DOMAIN}" -s "$DKIM_SELECTOR" -v
  chown opendkim:opendkim "/etc/opendkim/keys/${DOMAIN}/${DKIM_SELECTOR}.private"
  chmod 600 "/etc/opendkim/keys/${DOMAIN}/${DKIM_SELECTOR}.private"
fi

cat > /etc/opendkim.conf <<EOF
Syslog                  yes
SyslogSuccess           yes
LogWhy                  yes
Canonicalization        relaxed/simple
Mode                    sv
SubDomains              no
AutoRestart             yes
AutoRestartRate         10/1M
Background              yes
DNSTimeout              5
SignatureAlgorithm      rsa-sha256
Socket                  local:/var/spool/postfix/opendkim/opendkim.sock
PidFile                 /run/opendkim/opendkim.pid
UserID                  opendkim:opendkim
UMask                   007
KeyTable                /etc/opendkim/key.table
SigningTable            refile:/etc/opendkim/signing.table
ExternalIgnoreList      /etc/opendkim/trusted.hosts
InternalHosts           /etc/opendkim/trusted.hosts
EOF

mkdir -p /var/spool/postfix/opendkim
chown opendkim:postfix /var/spool/postfix/opendkim
chmod 750 /var/spool/postfix/opendkim
usermod -aG opendkim postfix 2>/dev/null || true

echo "${DKIM_SELECTOR}._domainkey.${DOMAIN} ${DOMAIN}:${DKIM_SELECTOR}:/etc/opendkim/keys/${DOMAIN}/${DKIM_SELECTOR}.private" \
  > /etc/opendkim/key.table
echo "*@${DOMAIN} ${DKIM_SELECTOR}._domainkey.${DOMAIN}" > /etc/opendkim/signing.table
cat > /etc/opendkim/trusted.hosts <<EOF
127.0.0.1
localhost
${HOSTNAME_FQDN}
*.${DOMAIN}
${DOMAIN}
EOF

if ! grep -q '^RUNDIR=' /etc/default/opendkim 2>/dev/null; then
  echo 'RUNDIR=/var/spool/postfix/opendkim' >> /etc/default/opendkim
else
  sed -i 's|^RUNDIR=.*|RUNDIR=/var/spool/postfix/opendkim|' /etc/default/opendkim
fi
mkdir -p /etc/systemd/system/opendkim.service.d
cat > /etc/systemd/system/opendkim.service.d/override.conf <<EOF
[Service]
ExecStart=
ExecStart=/usr/sbin/opendkim -x /etc/opendkim.conf -u opendkim -P /run/opendkim/opendkim.pid
EOF

postconf -e "milter_default_action = accept"
postconf -e "milter_protocol = 6"
postconf -e "smtpd_milters = local:opendkim/opendkim.sock"
postconf -e "non_smtpd_milters = local:opendkim/opendkim.sock"

# --- Firewall / fail2ban (guide hardening) ---
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  # Do NOT open 25/587 publicly — prevents open-relay abuse
  ufw --force enable || true
fi
systemctl enable fail2ban
systemctl restart fail2ban || true

postfix check
systemctl enable opendkim postfix dovecot
systemctl daemon-reload
systemctl restart opendkim
systemctl restart postfix
systemctl restart dovecot || true

# --- Authenticated HTTP mailer API (store console path) ---
mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/vps_mailer.py" ]]; then
  cp -f "${SCRIPT_DIR}/vps_mailer.py" "${INSTALL_DIR}/vps_mailer.py"
fi
if [[ -f "${SCRIPT_DIR}/verify_mail_setup.sh" ]]; then
  cp -f "${SCRIPT_DIR}/verify_mail_setup.sh" "${INSTALL_DIR}/verify_mail_setup.sh"
  chmod +x "${INSTALL_DIR}/verify_mail_setup.sh"
fi
if [[ -f "${SCRIPT_DIR}/mail_log_digest.sh" ]]; then
  cp -f "${SCRIPT_DIR}/mail_log_digest.sh" "${INSTALL_DIR}/mail_log_digest.sh"
  chmod +x "${INSTALL_DIR}/mail_log_digest.sh"
fi

cat > /etc/systemd/system/dtd-vps-mailer.service <<EOF
[Unit]
Description=DTD VPS mailer API
After=network.target postfix.service opendkim.service

[Service]
Type=simple
# Auth/transport secrets come from poller.env so AWS SES (SMTP_HOST/USERNAME/PASSWORD,
# VPS_MAIL_MODE) is honored as the primary relay and Postfix stays a fallback.
EnvironmentFile=/opt/dtd-mailer/poller.env
Environment=VPS_MAILER_SECRET=${SECRET}
Environment=MAIL_FROM=${MAIL_FROM}
Environment=MAIL_DOMAIN=${DOMAIN}
Environment=BIND_HOST=127.0.0.1
Environment=BIND_PORT=8787
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/vps_mailer.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dtd-vps-mailer
systemctl restart dtd-vps-mailer

# --- Monitoring cron (guide) ---
cat > /etc/cron.daily/dtd-mail-digest <<EOF
#!/bin/bash
${INSTALL_DIR}/mail_log_digest.sh >> ${INSTALL_DIR}/mail-digest.log 2>&1 || true
EOF
chmod +x /etc/cron.daily/dtd-mail-digest

# --- DNS artifact ---
DKIM_FILE="/etc/opendkim/keys/${DOMAIN}/${DKIM_SELECTOR}.txt"
DKIM_RAW=""
if [[ -f "$DKIM_FILE" ]]; then
  DKIM_RAW="$(cat "$DKIM_FILE")"
fi

cat > "${INSTALL_DIR}/DNS_RECORDS.txt" <<EOF
# Publish these for ${DOMAIN} (VPS ${VPS_IP})
# Hostname must match PTR.

A     ${HOSTNAME_FQDN}                 ${VPS_IP}
MX    ${DOMAIN}.                       10 ${HOSTNAME_FQDN}.
PTR   ${VPS_IP}                        ${HOSTNAME_FQDN}   # set at VPS provider
TXT   ${DOMAIN}.                       "v=spf1 ip4:${VPS_IP} -all"
TXT   _dmarc.${DOMAIN}.                "v=DMARC1; p=none; rua=mailto:${MAIL_FROM}; pct=100"
TXT   ${DKIM_SELECTOR}._domainkey.${DOMAIN}.
# paste DKIM value from:
#   cat /etc/opendkim/keys/${DOMAIN}/${DKIM_SELECTOR}.txt

${DKIM_RAW}
EOF

cat > "${INSTALL_DIR}/SASL_LOCAL.txt" <<EOF
Local SMTP submission (VPS only — not public):
  host: 127.0.0.1
  port: 587
  user: ${SASL_USER}
  pass: (same as VPS_MAILER_SECRET)
  TLS: required
Store console uses HTTP mailer on 127.0.0.1:8787 with X-Mailer-Secret instead.
EOF

cat <<EOF

========== INSTALL COMPLETE ==========
Hostname: ${HOSTNAME_FQDN}
VPS IP:   ${VPS_IP:-UNKNOWN}

Guide coverage:
  [x] Postfix Internet Site + myhostname/mydomain
  [x] Anti open-relay restrictions
  [x] TLS (Let's Encrypt when DNS ready)
  [x] Dovecot SASL + localhost:587 submission
  [x] OpenDKIM signing milter
  [x] Bulk queue tuning
  [x] ufw + fail2ban
  [x] DNS checklist file: ${INSTALL_DIR}/DNS_RECORDS.txt
  [x] Daily mail.log digest cron
  [x] HTTP mailer API (store path): 127.0.0.1:8787

Next:
  1) Publish DNS from ${INSTALL_DIR}/DNS_RECORDS.txt (incl. PTR at provider)
  2) Check IP: https://mxtoolbox.com/blacklists.aspx
  3) bash ${INSTALL_DIR}/verify_mail_setup.sh
  4) Tunnel mailer → set VPS_MAILER_URL → push Pages secrets
  5) mail-tester.com → warm up slowly (tens/day first)

EOF
