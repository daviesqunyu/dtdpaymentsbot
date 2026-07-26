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
    timeout=30,
)
cmd = r"""
echo '=== services ==='
systemctl is-active postfix dtd-vps-mailer dtd-smtp-poller
echo '=== mailq ==='
mailq | tail -n 30
echo '=== poller journal ==='
journalctl -u dtd-smtp-poller -n 40 --no-pager
echo '=== mail log ==='
if [ -f /var/log/mail.log ]; then tail -n 40 /var/log/mail.log; else journalctl -t postfix/smtp -n 40 --no-pager; fi
echo '=== health ==='
curl -sS http://127.0.0.1:8443/health || true
echo
echo '=== postconf key ==='
postconf myhostname mydomain inet_interfaces relayhost smtp_tls_security_level
"""
_, o, e = c.exec_command(cmd, timeout=90)
while not o.channel.exit_status_ready():
    time.sleep(0.3)
print(o.read().decode("utf-8", "replace")[-6000:])
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR", err[-1500:])
c.close()
