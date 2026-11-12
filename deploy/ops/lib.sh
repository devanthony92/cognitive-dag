#!/usr/bin/env bash
# Shared helpers of the operation scripts (F9, ADR-0094, ADR-0095). Sourced, never run.
#
# Every path can be moved with an environment variable, which is how the tests run the scripts in a
# temporary directory; on the VM the defaults apply. Nothing here prints a secret: files of the
# secrets directory are only ever read to be sent to a command through its standard input.
#
#   CDAG_ROOT         the checkout of the repository (never moved by a deploy)  /opt/cognitive-dag
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

STATE_DIR="$CDAG_STATE/state"
# Each deployed commit runs from its own export of deploy/ (deploy.sh makes it); the checkout in
# CDAG_ROOT is only the source of those exports and of the units that run from it.
RELEASES_DIR="$STATE_DIR/releases"
COMPOSE_FILE="$CDAG_ROOT/deploy/compose.prod.yaml"
DUMP_DIR="$CDAG_STATE/dumps"
# Configuration of the services with state (ADR-0100). It is copied here from the release, to a path
# that does not depend on the commit, so that Compose does not recreate Valkey, PostgreSQL and
# Temporal when only the commit changes: their mounts keep the same source, and the label with the
# hash of the content makes Compose recreate a service only when its configuration really changed.
# Nothing secret goes in these directories (the secrets are on the tmpfs).
SERVICE_CONFIG_DIR="$CDAG_STATE/config"
CONFIG_SERVICES=(valkey postgres temporal)
ALERT_DIR="$CDAG_STATE/alerts"
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-300}"
export WAIT_TIMEOUT
# The registry credential lives on the tmpfs too: `docker login` writes its config there.
DOCKER_CONFIG="${DOCKER_CONFIG:-$(dirname "$CDAG_SECRETS")/docker}"
export DOCKER_CONFIG

# The version whose images the next compose command uses (a file of KEY=value lines); empty = none.
VERSION_ENV=""
# The deploy/ directory of that version (its export, or the checkout when it has none).
RELEASE_DEPLOY_DIR="$CDAG_ROOT/deploy"

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
# The compose file is the one of that version's commit when its export exists, else the checkout's.
use_version() {
  local sha=""
  VERSION_ENV="$1"
  COMPOSE_FILE="$CDAG_ROOT/deploy/compose.prod.yaml"
  RELEASE_DEPLOY_DIR="$CDAG_ROOT/deploy"
  [[ -z "$1" || ! -f "$1" ]] || sha="$(sed -n 's/^GIT_SHA=//p' "$1" | tail -n 1)"
  if [[ "$sha" =~ ^[0-9a-f]{40}$ && -f "$RELEASES_DIR/$sha/deploy/compose.prod.yaml" ]]; then
    COMPOSE_FILE="$RELEASES_DIR/$sha/deploy/compose.prod.yaml"
    RELEASE_DEPLOY_DIR="$RELEASES_DIR/$sha/deploy"
  fi
}

# Prints the SHA-256 of the names and the content of the files of a directory ("none" without it).
config_hash() {
  [[ -d "$1" ]] || {
    echo none
    return 0
  }
  (
    cd "$1" &&
      find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
  )
}

# Copies the configuration of each service with state from the version set by use_version to
# SERVICE_CONFIG_DIR/<service>, only when its content differs. Each directory is built aside and
# renamed into place, so a failure never leaves one half written.
install_service_config() {
  local svc src target stage old
  mkdir -p "$SERVICE_CONFIG_DIR"
  chmod 0755 "$SERVICE_CONFIG_DIR"
  for svc in "${CONFIG_SERVICES[@]}"; do
    src="$RELEASE_DEPLOY_DIR/$svc"
    target="$SERVICE_CONFIG_DIR/$svc"
    [[ -d "$src" ]] || die "the version has no configuration directory for $svc ($src)"
    [[ "$(config_hash "$src")" != "$(config_hash "$target")" ]] || continue
    stage="$SERVICE_CONFIG_DIR/.new.$svc.$$"
    old="$SERVICE_CONFIG_DIR/.old.$svc.$$"
    rm -rf "$stage" "$old"
    mkdir -p "$stage"
    # The container users (999, 1000) read these files through the bind mount.
    if ! { (umask 022 && cp -R "$src/." "$stage/") && chmod -R a+rX,go-w "$stage" && chmod 0755 "$stage"; }; then
      rm -rf "$stage"
      die "cannot copy the configuration of $svc"
    fi
    if [[ -e "$target" ]]; then mv "$target" "$old"; fi
    mv "$stage" "$target"
    rm -rf "$old"
    log "configuration of $svc installed in $target"
  done
}

# docker compose with the config files, the version in VERSION_ENV and the directories: the secrets,
# the PKI, and per service with state its stable configuration directory and the hash of it.
compose() {
  local files=(--env-file "$CDAG_CONFIG_DIR/cognitive-dag.env" --env-file "$CDAG_CONFIG_DIR/local.env")
  local vars=() svc upper
  [[ -z "$VERSION_ENV" ]] || files+=(--env-file "$VERSION_ENV")
  for svc in "${CONFIG_SERVICES[@]}"; do
    upper="${svc^^}"
    vars+=("${upper}_CONFIG_DIR=$SERVICE_CONFIG_DIR/$svc" "${upper}_CONFIG_HASH=$(config_hash "$SERVICE_CONFIG_DIR/$svc")")
  done
  (
    export SECRETS_DIR="$CDAG_SECRETS" PKI_DIR="$CDAG_PKI" "${vars[@]}"
    docker compose "${files[@]}" -f "$COMPOSE_FILE" "$@"
  )
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
