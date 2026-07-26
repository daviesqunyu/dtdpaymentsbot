#!/usr/bin/env python3
"""Refresh CF Email Sending token on Pages + align VPS mailer secret."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = "a2e2c51398c9594ae377828f88ad3d70"


def load_dotenv() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), values[k.strip()])
    return values


def wrangler_oauth() -> str:
    toml = Path.home() / "AppData/Roaming/xdg.config/.wrangler/config/default.toml"
    text = toml.read_text(encoding="utf-8")
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', text)
    if not m:
        raise SystemExit("No wrangler oauth_token — run: npx wrangler login")
    exp = re.search(r'expiration_time\s*=\s*"([^"]+)"', text)
    if exp:
        print("oauth_expires", exp.group(1))
    return m.group(1)


def cf_send(token: str, to: str) -> dict:
    body = {
        "to": [to],
        "from": {"address": "contact@dvtechnologies.xyz", "name": "DV Technologies"},
        "subject": "DTD email repair check",
        "text": "Cloudflare Email Sending is working again.",
        "html": "<p>Cloudflare Email Sending is working again.</p>",
    }
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/email/sending/send",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"success": False, "status": e.code, "body": e.read().decode()[:400]}


def main() -> None:
    env = load_dotenv()
    token = wrangler_oauth()
    print("token_len", len(token))

    probe = cf_send(token, "daviesqunyu@gmail.com")
    print("probe", json.dumps(probe)[:400])
    if not probe.get("success"):
        print("CF send failed — re-login: npx wrangler login", file=sys.stderr)
        sys.exit(1)

    # Workers Free can only send to verified Email Routing destinations.
    # Probe an arbitrary address to detect missing Email Sending entitlement.
    arbitrary = cf_send(token, "dtd-email-probe-unverified@example.com")
    arb_body = json.dumps(arbitrary)
    if "sending_disabled" in arb_body or arbitrary.get("success") is False:
        print(
            "[warn] Arbitrary recipients are blocked (Workers Free / Email Sending not enabled).\n"
            "  Fix: Upgrade to Workers Paid, then:\n"
            "    npx wrangler email sending enable dvtechnologies.xyz\n"
            "  Dashboard: Compute → Email Service → Email Sending → Onboard Domain\n"
            "  Verified-only sends still work (daviesqunyu@gmail.com, daviskunyu@gmail.com, …).",
            file=sys.stderr,
        )

    # Write token into local .env for push-secrets (non-destructive upsert)
    env_path = ROOT / ".env"
    raw = env_path.read_text(encoding="utf-8")
    lines = raw.splitlines()
    updates = {
        "CF_ACCOUNT_ID": ACCOUNT,
        "CLOUDFLARE_ACCOUNT_ID": ACCOUNT,
        "CF_EMAIL_API_TOKEN": token,
        "CLOUDFLARE_API_TOKEN": token,
    }
    for key, val in updates.items():
        found = False
        for i, line in enumerate(lines):
            if line.startswith(f"{key}="):
                lines[i] = f"{key}={val}"
                found = True
                break
        if not found:
            lines.append(f"{key}={val}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("[ok] wrote CF email token keys into .env")

    # Push Pages secrets via existing script keys — extend push then run
    from subprocess import run

    # Ensure push-secrets includes CF keys
    push = (ROOT / "scripts" / "push-secrets.mjs").read_text(encoding="utf-8")
    for key in ("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "CF_EMAIL_API_TOKEN", "CLOUDFLARE_API_TOKEN"):
        if f'"{key}"' not in push:
            print(f"[warn] add {key} to push-secrets.mjs secretKeys if missing")

    r = run(["node", "scripts/push-secrets.mjs"], cwd=str(ROOT), shell=True)
    if r.returncode != 0:
        # Fallback bulk upload just CF keys
        bulk = "\n".join(f"{k}={v}" for k, v in updates.items())
        r2 = run(
            ["npx", "wrangler", "pages", "secret", "bulk", "-", "--project-name", "dtdpaymentsbot"],
            cwd=str(ROOT),
            input=bulk,
            text=True,
            shell=True,
        )
        if r2.returncode != 0:
            sys.exit(r2.returncode)
    print("[ok] Pages secrets refreshed")

    # Align VPS mailer secret so fallback is not "forbidden"
    secret = env.get("VPS_MAILER_SECRET", "")
    if secret:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(
            env.get("VPS_HOST", "185.209.229.34"),
            username=env.get("VPS_USER", "root"),
            password=env["VPS_PASS"],
            timeout=40,
        )
        # Update systemd unit Environment= and poller.env
        cmd = f"""
set -e
SEC='{secret.replace("'", "'\\''")}'
# poller.env
grep -q '^VPS_MAILER_SECRET=' /opt/dtd-mailer/poller.env \\
  && sed -i "s|^VPS_MAILER_SECRET=.*|VPS_MAILER_SECRET=$SEC|" /opt/dtd-mailer/poller.env \\
  || echo "VPS_MAILER_SECRET=$SEC" >> /opt/dtd-mailer/poller.env
# mailer service file
if grep -q 'VPS_MAILER_SECRET=' /etc/systemd/system/dtd-vps-mailer.service; then
  sed -i "s|^Environment=VPS_MAILER_SECRET=.*|Environment=VPS_MAILER_SECRET=$SEC|" /etc/systemd/system/dtd-vps-mailer.service
fi
systemctl daemon-reload
systemctl restart dtd-vps-mailer dtd-smtp-poller
systemctl is-active dtd-vps-mailer dtd-smtp-poller
"""
        _i, out, err = ssh.exec_command(cmd, timeout=60)
        print(out.read().decode("utf-8", "replace"))
        e = err.read().decode("utf-8", "replace")
        if e.strip():
            print(e[:300], file=sys.stderr)
        ssh.close()
        print("[ok] VPS mailer secret aligned")

    print("[ok] Email path repaired. Redeploy Pages if functions changed: npm run deploy")


if __name__ == "__main__":
    main()
