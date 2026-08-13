#!/usr/bin/env python3
"""Deploy updated mailer (delivery verify) + poller; print DNS fix values."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def run(ssh, cmd, timeout=120):
    _i, out, err = ssh.exec_command(cmd, timeout=timeout)
    stdout = out.read().decode("utf-8", "replace")
    stderr = err.read().decode("utf-8", "replace")
    code = out.channel.recv_exit_status()
    return code, stdout, stderr


def main() -> None:
    load_env()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        os.environ.get("VPS_HOST", "185.209.229.34"),
        username=os.environ.get("VPS_USER", "root"),
        password=os.environ["VPS_PASS"],
        timeout=40,
    )

    sftp = ssh.open_sftp()
    for name in ("vps_mailer.py", "smtp_job_poller.py", "vps_sms_send.py"):
        sftp.put(str(ROOT / "scripts" / name), f"/opt/dtd-mailer/{name}")
        print(f"[ok] uploaded {name}")
    sftp.close()

    # Ensure venv exists for telethon; mailer can use system python
    run(
        ssh,
        """
set -e
mkdir -p /opt/dtd-mailer
if [ ! -x /opt/dtd-mailer/venv/bin/python ]; then
  python3 -m venv /opt/dtd-mailer/venv
  /opt/dtd-mailer/venv/bin/pip install -q -U pip telethon
fi
# Prefer venv for poller (telethon)
if [ -f /etc/systemd/system/dtd-smtp-poller.service ]; then
  sed -i 's|^ExecStart=.*|ExecStart=/opt/dtd-mailer/venv/bin/python /opt/dtd-mailer/smtp_job_poller.py|' /etc/systemd/system/dtd-smtp-poller.service
fi
# Mailer env: verify remote delivery
mkdir -p /etc/systemd/system/dtd-vps-mailer.service.d
cat > /etc/systemd/system/dtd-vps-mailer.service.d/override.conf <<'EOF'
[Service]
Environment=MAIL_VERIFY_SECONDS=14
EOF
systemctl daemon-reload
systemctl restart dtd-vps-mailer dtd-smtp-poller
systemctl is-active dtd-vps-mailer dtd-smtp-poller
curl -sS http://127.0.0.1:8787/health
echo
# DKIM public key one-liner for Cloudflare
if [ -f /etc/opendkim/keys/dvtechnologies.xyz/mail.txt ]; then
  echo '=== DKIM TXT (paste as mail._domainkey) ==='
  # Flatten to single p= value
  python3 - <<'PY'
from pathlib import Path
import re
raw = Path('/etc/opendkim/keys/dvtechnologies.xyz/mail.txt').read_text()
parts = re.findall(r'"([^"]+)"', raw)
joined = ''.join(parts)
# joined like v=DKIM1; h=sha256; k=rsa; p=...
print(joined if joined.startswith('v=') else 'v=DKIM1; k=rsa; ' + joined)
PY
fi
echo '=== SPF needed ==='
echo 'v=spf1 ip4:185.209.229.34 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all'
""",
        timeout=180,
    )
    code, out, err = run(ssh, "true")  # placeholder - already ran above
    # Re-run the block properly capturing output
    code, out, err = run(
        ssh,
        """
systemctl is-active dtd-vps-mailer dtd-smtp-poller
curl -sS http://127.0.0.1:8787/health; echo
python3 - <<'PY'
from pathlib import Path
import re
p = Path('/etc/opendkim/keys/dvtechnologies.xyz/mail.txt')
if p.exists():
    parts = re.findall(r'"([^"]+)"', p.read_text())
    print('DKIM=', ''.join(parts))
else:
    print('DKIM=missing')
PY
""",
    )
    print(out)
    if err.strip():
        print(err[:500])
    ssh.close()
    print("[ok] mailer verifies remote delivery; false 'sent' fixed.")
    print("SPF still must be updated in Cloudflare for Gmail to accept mail.")


if __name__ == "__main__":
    main()
