#!/usr/bin/env bash
# Daily Postfix log digest (guide: monitor bounces / queue / rejects).
set -euo pipefail

LOG="${MAIL_LOG:-/var/log/mail.log}"
[[ -f "$LOG" ]] || LOG="/var/log/mail.log.1"
[[ -f "$LOG" ]] || { echo "$(date -Is) no mail.log"; exit 0; }

TODAY="$(date +%b\ %e)"
# Busybox/date variants: also try ISO
LINES="$(grep -E "$(date +%Y-%m-%d)|${TODAY}" "$LOG" 2>/dev/null || tail -n 5000 "$LOG")"

sent=$(printf '%s\n' "$LINES" | grep -c 'status=sent' || true)
bounced=$(printf '%s\n' "$LINES" | grep -ciE 'status=bounced|undeliverable' || true)
deferred=$(printf '%s\n' "$LINES" | grep -c 'status=deferred' || true)
reject=$(printf '%s\n' "$LINES" | grep -ciE 'reject|NOQUEUE' || true)
queue="$(mailq 2>/dev/null | tail -n 1 || echo 'mailq n/a')"

cat <<EOF
$(date -Is) mail digest
  sent=${sent} bounced=${bounced} deferred=${deferred} reject=${reject}
  queue: ${queue}
EOF
