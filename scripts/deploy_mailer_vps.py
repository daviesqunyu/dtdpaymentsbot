"""Upload vps_mailer.py to the VPS and install the systemd service.

Requires env: VPS_HOST, VPS_USER, VPS_PASS, VPS_MAILER_SECRET
Optional: MAIL_FROM (default contact@dvtechnologies.xyz)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

try:
    import paramiko
except ImportError:
    print("pip install paramiko python-dotenv")
    sys.exit(1)

HOST = os.environ.get("VPS_HOST", "185.209.229.34")
USER = os.environ.get("VPS_USER", "root")
PASSWORD = os.environ.get("VPS_PASS", "")
SECRET = os.environ.get("VPS_MAILER_SECRET", "")
MAIL_FROM = os.environ.get("MAIL_FROM") or os.environ.get("SUPPORT_EMAIL") or "contact@dvtechnologies.xyz"
MAIL_DOMAIN = os.environ.get("MAIL_DOMAIN", "dvtechnologies.xyz")
MAIL_HOSTNAME = os.environ.get("MAIL_HOSTNAME", f"mail.{MAIL_DOMAIN}")
REMOTE = "/opt/dtd-mailer"


def main() -> None:
    if not PASSWORD:
        print("Set VPS_PASS")
        sys.exit(1)
    if not SECRET:
        print("Set VPS_MAILER_SECRET in .env first")
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = client.open_sftp()

    stdin, stdout, stderr = client.exec_command(f"mkdir -p {REMOTE}")
    stdout.channel.recv_exit_status()

    local_py = ROOT / "scripts" / "vps_mailer.py"
    local_sh = ROOT / "scripts" / "install_vps_mailer.sh"
    sftp.put(str(local_py), f"{REMOTE}/vps_mailer.py")
    sftp.put(str(local_sh), f"{REMOTE}/install_vps_mailer.sh")
    for name in ("verify_mail_setup.sh", "mail_log_digest.sh"):
        local = ROOT / "scripts" / name
        if local.exists():
            sftp.put(str(local), f"{REMOTE}/{name}")
    sftp.close()

    cmd = (
        f"chmod +x {REMOTE}/install_vps_mailer.sh && "
        f"VPS_MAILER_SECRET={SECRET!r} MAIL_FROM={MAIL_FROM!r} "
        f"bash {REMOTE}/install_vps_mailer.sh"
    )
    # Safer without shell quoting issues:
    cmd = (
        f"chmod +x {REMOTE}/install_vps_mailer.sh; "
        f"export VPS_MAILER_SECRET='{SECRET}'; "
        f"export MAIL_FROM='{MAIL_FROM}'; "
        f"export MAIL_DOMAIN='{MAIL_DOMAIN}'; "
        f"export MAIL_HOSTNAME='{MAIL_HOSTNAME}'; "
        f"export VPS_IP='{HOST}'; "
        f"bash {REMOTE}/install_vps_mailer.sh"
    )
    print(f"$ install on {HOST}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=300)
    print(stdout.read().decode("utf-8", "replace")[:3000])
    err = stderr.read().decode("utf-8", "replace")
    if err.strip():
        print(err[:1500])
    code = stdout.channel.recv_exit_status()
    client.close()
    if code != 0:
        sys.exit(code)
    print("[ok] VPS mailer deployed (localhost:8787). Expose via tunnel, then set VPS_MAILER_URL.")


if __name__ == "__main__":
    main()
