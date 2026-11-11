#!/usr/bin/env bash
# Shared helpers of the operation scripts (F9, ADR-0094, ADR-0095). Sourced, never run.
#
# Every path can be moved with an environment variable, which is how the tests run the scripts in a
# temporary directory; on the VM the defaults apply. Nothing here prints a secret: files of the
# secrets directory are only ever read to be sent to a command through its standard input.
#
#   CDAG_ROOT         the checkout of the repository (compose file, scripts)    /opt/cognitive-dag
#   CDAG_STATE        state of the deployments, dumps, alert state              /var/lib/cognitive-dag
#   CDAG_SECRETS      secret files, on a tmpfs                                  /run/cognitive-dag/secrets
#   CDAG_PKI          internal PKI leaves, on a tmpfs                           /run/cognitive-dag/pki
#   CDAG_CONFIG_DIR   cognitive-dag.env (constants) and local.env (operator)    /etc/cognitive-dag
#   CDAG_LOG_DIR      archived service logs (90 days)                           /var/log/cognitive-dag

CDAG_ROOT="${CDAG_ROOT:-/opt/cognitive-dag}"
CDAG_STATE="${CDAG_STATE:-/var/lib/cognitive-dag}"
CDAG_SECRETS="${CDAG_SECRETS:-/run/cognitive-dag/secrets}"
CDAG_PKI="${CDAG_PKI:-/run/cognitive-dag/pki}"
CDAG_CONFIG_DIR="${CDAG_CONFIG_DIR:-/etc/cognitive-dag}"
CDAG_LOG_DIR="${CDAG_LOG_DIR:-/var/log/cognitive-dag}"

COMPOSE_FILE="$CDAG_ROOT/deploy/compose.prod.yaml"
STATE_DIR="$CDAG_STATE/state"
DUMP_DIR="$CDAG_STATE/dumps"
ALERT_DIR="$CDAG_STATE/alerts"
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-300}"
export WAIT_TIMEOUT
# The registry credential lives on the tmpfs too: `docker login` writes its config there.
DOCKER_CONFIG="${DOCKER_CONFIG:-$(dirname "$CDAG_SECRETS")/docker}"
export DOCKER_CONFIG

# The version whose images the next compose command uses (a file of KEY=value lines); empty = none.
VERSION_ENV=""

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() {
  log "error: $1" >&2
  exit "${2:-1}"
}

# Reads KEY=value lines of a config file into the environment, without running anything in it and
# without overriding a variable that is already set (the environment wins over the files).
load_env_file() {
  local file="$1" line key value
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    [[ -z "${!key+x}" ]] || continue
    export "$key=$value"
  done <"$file"
}

load_config() {
  load_env_file "$CDAG_CONFIG_DIR/cognitive-dag.env"
  load_env_file "$CDAG_CONFIG_DIR/local.env"
}

require_config() {
  [[ -f "$CDAG_CONFIG_DIR/cognitive-dag.env" && -f "$CDAG_CONFIG_DIR/local.env" ]] ||
    die "missing $CDAG_CONFIG_DIR/cognitive-dag.env or local.env (see docs/operations/provisioning.md)"
  load_config
  [[ -n "${SITE_DOMAIN:-}" ]] || die "SITE_DOMAIN is not set in local.env"
}

# The secrets are only ever on the tmpfs, put there by cognitive-dag-secrets.service.
require_secrets() {
  [[ -s "$CDAG_SECRETS/postgres_superuser_password" ]] ||
    die "the secrets are not on the tmpfs: run 'systemctl start cognitive-dag-secrets' (the Vault must answer)"
}

# use_version <file>: the version file whose images the next compose commands use ("" = none).
use_version() { VERSION_ENV="$1"; }

# docker compose with the config files, the version in VERSION_ENV and the two directories.
compose() {
  local files=(--env-file "$CDAG_CONFIG_DIR/cognitive-dag.env" --env-file "$CDAG_CONFIG_DIR/local.env")
  [[ -z "$VERSION_ENV" ]] || files+=(--env-file "$VERSION_ENV")
  SECRETS_DIR="$CDAG_SECRETS" PKI_DIR="$CDAG_PKI" \
    docker compose "${files[@]}" -f "$COMPOSE_FILE" "$@"
}

state_value() { # state_value <file> <KEY>: a value of a version file, empty when there is none
  local file="$STATE_DIR/$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

ensure_dirs() {
  mkdir -p "$STATE_DIR" "$DUMP_DIR" "$ALERT_DIR" "$DOCKER_CONFIG"
  chmod 700 "$DOCKER_CONFIG" 2>/dev/null || true
}
