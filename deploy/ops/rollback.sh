#!/usr/bin/env bash
# Goes back to the previous version (F9, T046, FR-025, ADR-0094).
#
#   rollback.sh
#
# Starts the digests of previous.env, waits for health and checks the headers of the real site; only
# then do current and previous swap places, so a second rollback goes forward again. No migration is
# run backwards: migrations are expand/contract and the previous code runs on the new schema. The
# dumps in the state directory are for a migration that broke that rule, restored by hand
# (docs/operations/deploy.md). Exits 1, with the state untouched, when there is no previous version
# or it does not become healthy.
set -euo pipefail
umask 077
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/lib.sh"

require_config
ensure_dirs
require_secrets

[[ -f "$STATE_DIR/previous.env" ]] || die "there is no previous version to go back to"
target="$(state_value previous.env GIT_SHA)"
was="$(state_value current.env GIT_SHA)"
log "rolling back from ${was:-none} to $target"

use_version "$STATE_DIR/previous.env"
install_service_config
if ! compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" --remove-orphans; then
  log "the previous version did not become healthy: state untouched, bringing the current one back"
  use_version "$STATE_DIR/current.env"
  install_service_config || true
  compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" --remove-orphans || true
  die "rollback failed"
fi
bash "$here/check-headers.sh" "$SITE_DOMAIN" || die "rollback failed: the headers of the real site do not match the contract"

mv "$STATE_DIR/current.env" "$STATE_DIR/swap.env"
mv "$STATE_DIR/previous.env" "$STATE_DIR/current.env"
mv "$STATE_DIR/swap.env" "$STATE_DIR/previous.env"
printf '%s rolled back from %s to %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${was:-none}" "$target" >>"$STATE_DIR/deploy.log"
log "rolled back to $target"
