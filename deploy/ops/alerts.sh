#!/usr/bin/env bash
# Alerts and log archive of the VM (F9, T049, FR-027, FR-028, D9C, D10A, ADR-0095).
#
#   alerts.sh check     one pass of the alert checks; mails the operator when one fires
#   alerts.sh archive   appends the new log lines of api, worker and edge to $CDAG_LOG_DIR/<service>.log
#
# A systemd timer runs both every 5 minutes (deploy/provision/systemd). The checks:
#   auth      more than ALERT_AUTH_THRESHOLD events auth.login_failed or auth.rate_limited in the
#             last ALERT_WINDOW_MINUTES (a sliding window over the `time` of each log line)
#   service   a service of the stack is missing, not running or unhealthy
#   certificate  an internal certificate expires in less than ALERT_CERT_MIN_DAYS days
#   disk      the disk of ALERT_DISK_PATH is at ALERT_DISK_PERCENT percent or more
# The mail goes through the same SMTP relay as the application, over STARTTLS with authentication;
# credentials are read from the secret files and given to curl on standard input, never as arguments.
# The same alert is not repeated within ALERT_COOLDOWN_MINUTES, and it is sent again at once if the
# condition cleared in between. Prints no secret. If the mail cannot be sent the pass exits 1, so
# the failed unit is itself visible in `systemctl --failed`.
#
# Needs: ALERT_EMAIL_TO (local.env on the VM, outside the repository), MAIL_FROM and SMTP_HOST.
set -euo pipefail
umask 077
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/lib.sh"

SERVICES=(edge api worker postgres valkey temporal temporal-ui)

mail_sent=0
mail_failed=0

# send_mail <subject> <body>
send_mail() {
  local subject="$1" body="$2" file sender credentials
  file="$(mktemp)"
  sender="${MAIL_FROM:-}"
  if [[ "$sender" =~ \<([^\>]+)\> ]]; then sender="${BASH_REMATCH[1]}"; fi
  {
    printf 'From: %s\r\n' "$MAIL_FROM"
    printf 'To: %s\r\n' "$ALERT_EMAIL_TO"
    printf 'Subject: [cognitive-dag] %s\r\n' "$subject"
    printf 'Date: %s\r\n' "$(date -u '+%a, %d %b %Y %H:%M:%S +0000')"
    printf 'Content-Type: text/plain; charset=utf-8\r\n\r\n'
    printf '%s\r\nHost: %s\r\nDomain: %s\r\n' "$body" "$(hostname)" "${SITE_DOMAIN:-unknown}"
  } >"$file"
  local cacert=()
  [[ -z "${ALERT_SMTP_CACERT:-}" ]] || cacert=(--cacert "$ALERT_SMTP_CACERT")
  credentials="$(tr -d '\r\n' <"$CDAG_SECRETS/smtp_user"):$(tr -d '\r\n' <"$CDAG_SECRETS/smtp_password")"
  credentials="${credentials//\\/\\\\}"
  credentials="${credentials//\"/\\\"}"
  if printf 'user = "%s"\n' "$credentials" | curl --silent --show-error --fail --max-time 60 \
    --ssl-reqd "${cacert[@]}" --url "smtp://$SMTP_HOST:${SMTP_PORT:-587}" \
    --mail-from "$sender" --mail-rcpt "$ALERT_EMAIL_TO" --upload-file "$file" -K - >/dev/null; then
    mail_sent=$((mail_sent + 1))
    log "alert sent: $subject"
  else
    mail_failed=1
    log "error: the alert mail could not be sent: $subject" >&2
  fi
  rm -f "$file"
}

# raise <key> <subject> <body>: mails unless the same alert was sent inside the cooldown.
raise() {
  local key="$1" marker="$ALERT_DIR/$1.sent" now last
  now="$(date +%s)"
  if [[ -f "$marker" ]]; then
    last="$(cat "$marker")"
    if ((now - last < ${ALERT_COOLDOWN_MINUTES:-60} * 60)); then
      log "alert $key is already sent: cooling down"
      return
    fi
  fi
  send_mail "$2" "$3"
  ((mail_failed)) || printf '%s\n' "$now" >"$marker"
}

clear_alert() { rm -f "$ALERT_DIR/$1.sent"; }

check_auth() {
  local window="${ALERT_WINDOW_MINUTES:-10}" threshold="${ALERT_AUTH_THRESHOLD:-20}" cutoff count
  cutoff="$(date -u -d "-$window minutes" +%Y-%m-%dT%H:%M:%S)"
  count="$(
    compose logs --no-color --no-log-prefix --since "${window}m" api 2>/dev/null |
      awk -v cutoff="$cutoff" '
        /"event":"auth\.(login_failed|rate_limited)"/ {
          if (match($0, /"time":"[^"]+"/)) {
            t = substr($0, RSTART + 8, 19)
            if (t >= cutoff) n++
          }
        }
        END { print n + 0 }'
  )"
  if ((count > threshold)); then
    raise auth "auth failures: $count in $window minutes" \
      "$count events auth.login_failed or auth.rate_limited in the last $window minutes (threshold $threshold)."
  else
    clear_alert auth
  fi
}

check_services() {
  local listing missing=() bad=() service line
  listing="$(compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || true)"
  for service in "${SERVICES[@]}"; do
    line="$(grep -E "^$service " <<<"$listing" | head -n 1 || true)"
    if [[ -z "$line" ]]; then
      missing+=("$service")
    elif [[ "$line" != "$service running"* || "$line" == *unhealthy* ]]; then
      bad+=("$line")
    fi
  done
  if ((${#missing[@]} + ${#bad[@]} > 0)); then
    raise service "service not healthy" "Missing: ${missing[*]:-none}. Not running or unhealthy: ${bad[*]:-none}."
  else
    clear_alert service
  fi
}

check_certificates() {
  local report
  if report="$(bash "$here/../provision/pki.sh" status "$CDAG_PKI" --min-days "${ALERT_CERT_MIN_DAYS:-30}" 2>&1)"; then
    clear_alert certificate
  else
    raise certificate "internal certificate expiring" "An internal certificate expires soon (rotation: docs/operations/secrets.md):
$report"
  fi
}

check_disk() {
  local path="${ALERT_DISK_PATH:-/}" used limit="${ALERT_DISK_PERCENT:-85}"
  used="$(df --output=pcent "$path" | tail -n 1 | tr -dc '0-9')"
  if ((used >= limit)); then
    raise disk "disk at ${used}%" "The disk of $path is at ${used}% (threshold ${limit}%). Logs and dumps are in $CDAG_LOG_DIR and $DUMP_DIR."
  else
    clear_alert disk
  fi
}

check() {
  [[ -n "${ALERT_EMAIL_TO:-}" ]] ||
    die "ALERT_EMAIL_TO is not set: put it in $CDAG_CONFIG_DIR/local.env (outside the repository)"
  : "${MAIL_FROM:?set MAIL_FROM}" "${SMTP_HOST:?set SMTP_HOST}"
  check_auth
  check_services
  check_certificates
  check_disk
  ((mail_failed == 0)) || exit 1
}

archive() {
  local now since service cursor="$ALERT_DIR/archive.cursor"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  since="1h"
  [[ ! -s "$cursor" ]] || since="$(cat "$cursor")"
  mkdir -p "$CDAG_LOG_DIR"
  for service in api worker edge; do
    # [since, now): the next pass starts where this one ended, so a line is neither lost nor repeated.
    compose logs --no-color --timestamps --since "$since" --until "$now" "$service" >>"$CDAG_LOG_DIR/$service.log"
  done
  printf '%s\n' "$now" >"$cursor"
}

command="${1:-}"
require_config
if [[ -f "$STATE_DIR/current.env" ]]; then use_version "$STATE_DIR/current.env"; fi
mkdir -p "$ALERT_DIR"
case "$command" in
  check) check ;;
  archive) archive ;;
  *) die "usage: alerts.sh check | archive" 2 ;;
esac
