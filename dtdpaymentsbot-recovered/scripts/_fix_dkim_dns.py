import os
import time
import paramiko
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "185.209.229.34",
    username="root",
    password=os.environ["VPS_PASS"],
    look_for_keys=False,
    allow_agent=False,
)

cmd = r"""
set -e
echo '=== opendkim status ==='
systemctl is-active opendkim || true
ls -la /etc/opendkim/keys/dvtechnologies.xyz/ || true
echo '=== DKIM TXT ==='
cat /etc/opendkim/keys/dvtechnologies.xyz/mail.txt 2>/dev/null || cat /etc/opendkim/keys/dvtechnologies.xyz/*.txt 2>/dev/null || echo 'NO_DKIM_KEY'
echo '=== milters ==='
postconf smtpd_milters non_smtpd_milters
echo '=== ensure opendkim running and postfix milter ==='
mkdir -p /var/spool/postfix/opendkim
chown opendkim:postfix /var/spool/postfix/opendkim || true
postconf -e 'milter_default_action = accept'
postconf -e 'milter_protocol = 6'
postconf -e 'smtpd_milters = local:opendkim/opendkim.sock'
postconf -e 'non_smtpd_milters = local:opendkim/opendkim.sock'
systemctl restart opendkim || true
systemctl restart postfix || true
sleep 1
systemctl is-active opendkim postfix
# write DNS helper
cat > /opt/dtd-mailer/DNS_RECORDS.txt <<EOF
# Publish these at your DNS for dvtechnologies.xyz

A mail.dvtechnologies.xyz -> 185.209.229.34
PTR 185.209.229.34 -> mail.dvtechnologies.xyz   (at VPS provider)

SPF TXT @ :
v=spf1 ip4:185.209.229.34 -all

DMARC TXT _dmarc :
v=DMARC1; p=none; rua=mailto:contact@dvtechnologies.xyz; pct=100

DKIM TXT mail._domainkey :
(see mail.txt below)
EOF
cat /etc/opendkim/keys/dvtechnologies.xyz/mail.txt >> /opt/dtd-mailer/DNS_RECORDS.txt 2>/dev/null || true
echo '=== DNS file ==='
cat /opt/dtd-mailer/DNS_RECORDS.txt
"""
_, o, e = c.exec_command(cmd, timeout=120)
while not o.channel.exit_status_ready():
    time.sleep(0.3)
print(o.read().decode("utf-8", "replace"))
print(e.read().decode("utf-8", "replace")[-1000:])
c.close()
