#!/usr/bin/env bash
# Read-only health report of this VM (F9, T046, FR-038): what runs, whether the secrets are on the
# tmpfs, the internal certificates, the disk and the last deployments. Exits 1 if something needs
# attention. Prints names, states and dates; never a secret.
set -uo pipefail
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/lib.sh"

problems=0
problem() {
  echo "PROBLEM: $*"
  problems=$((problems + 1))
}

require_config

echo "== version"
echo "current:  $(state_value current.env GIT_SHA)"
echo "previous: $(state_value previous.env GIT_SHA)"
[[ -f "$STATE_DIR/current.env" ]] || problem "no version has been deployed"

echo "== secrets"
fs="$(stat -f -c %T "$CDAG_SECRETS" 2>/dev/null || echo missing)"
case "$fs" in
  tmpfs | ramfs) echo "secrets directory: $fs" ;;
  *) problem "the secrets directory is not a tmpfs ($fs)" ;;
esac
count="$(find "$CDAG_SECRETS" -maxdepth 1 -type f 2>/dev/null | wc -l)"
echo "secret files: $count"
((count >= 10)) || problem "fewer secret files than expected ($count)"

echo "== services"
if [[ -f "$STATE_DIR/current.env" ]]; then use_version "$STATE_DIR/current.env"; fi
services="$(compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || true)"
echo "$services"
[[ -n "$services" ]] || problem "no service is running"
if grep -Eq ' (unhealthy|restarting|exited|dead)' <<<"$services"; then problem "a service is not healthy"; fi

echo "== internal certificates"
bash "$CDAG_ROOT/deploy/provision/pki.sh" status "$CDAG_PKI" --min-days "${ALERT_CERT_MIN_DAYS:-30}" ||
  problem "an internal certificate is close to expiring: see docs/operations/secrets.md"

echo "== disk"
df -hP "${ALERT_DISK_PATH:-/}" | tail -n 1

echo "== last deployments"
tail -n 5 "$STATE_DIR/deploy.log" 2>/dev/null || echo "(none)"
echo "dumps: $(find "$DUMP_DIR" -maxdepth 1 -name 'predeploy-*.dump' 2>/dev/null | wc -l)"

if ((problems > 0)); then
  echo "$problems problem(s)"
  exit 1
fi
echo "ok"
