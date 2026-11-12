#!/usr/bin/env bash
# Secrets of the deployment in OCI Vault (F9, T044, FR-015, D4B, ADR-0093).
#
# On the VM (run by cognitive-dag-secrets.service, as root, with the instance principal: no API key):
#   secrets.sh fetch              read every secret from the Vault into a tmpfs and issue the
#                                 internal certificates; fails closed, leaving nothing, if the Vault
#                                 does not answer, a secret is missing or the target is not a tmpfs
#
# On the operator machine (with the operator's own OCI profile; the VM has no write permission):
#   secrets.sh init-generated     create the secrets the deployment generates (database and Valkey
#                                 passwords, master key, internal CA); never overwrites one that exists
#   secrets.sh put <name>         store a secret read from standard input as a new version
#   secrets.sh list               show which secrets exist (names only)
#
# Names in the Vault are `cdag-<name>`. Nothing is printed that came from a secret. On the operator
# side the value travels to the OCI CLI as a base64 argument, visible to the local user's processes
# while the command runs: do it on a machine only you use (docs/operations/secrets.md).
set -euo pipefail
umask 077
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/../ops/lib.sh"

GENERATED=(postgres_superuser_password app_migrator_password app_runtime_password temporal_db_password valkey_password credentials_master_key)
DELIVERED=(gemini_api_key smtp_user smtp_password ocir_pull_token)
CA_NAMES=(pki_ca_key pki_ca_crt)
FETCH_NAMES=("${GENERATED[@]}" "${DELIVERED[@]}" "${CA_NAMES[@]}")
# The CLI of the operator and the VM: a venv linked here by provision.sh.
CLEANUP=()
trap 'rm -rf "${CLEANUP[@]}"' EXIT
OCI_RETRY=(--connection-timeout 10 --read-timeout 30 --max-retries 2)

require_tmpfs() {
  local type
  type="$(stat -f -c %T "$1" 2>/dev/null || true)"
  case "$type" in
    tmpfs | ramfs) ;;
    *) die "$1 is not a tmpfs (it is '${type:-unknown}'): refusing to write secrets there" ;;
  esac
}

is_secret_name() {
  local name="$1" candidate
  for candidate in "${FETCH_NAMES[@]}"; do [[ "$candidate" == "$name" ]] && return 0; done
  return 1
}

# ---------------------------------------------------------------- VM side

vault_get() { # vault_get <name>: the value of the current version, base64 as the Vault returns it
  oci secrets secret-bundle get-secret-bundle-by-name --auth instance_principal "${OCI_RETRY[@]}" \
    --vault-id "$VAULT_OCID" --secret-name "cdag-$1" \
    --query 'data."secret-bundle-content".content' --raw-output
}

fetch() {
  load_config
  : "${VAULT_OCID:?VAULT_OCID is not set in cognitive-dag.env}"
  local parent stage pki_stage name encoded owner=""
  parent="$(dirname "$CDAG_SECRETS")"
  mkdir -p "$parent"
  require_tmpfs "$parent"
  stage="$parent/.secrets.new.$$"
  pki_stage="$parent/.pki.new.$$"
  rm -rf "$stage" "$pki_stage"
  CLEANUP+=("$stage" "$pki_stage")
  mkdir -m 700 "$stage" "$pki_stage"

  for name in "${FETCH_NAMES[@]}"; do
    encoded="$(vault_get "$name")" || die "cannot read the secret '$name' from the Vault: is the Vault answering? Nothing was written"
    [[ -n "$encoded" ]] || die "the secret '$name' is empty in the Vault"
    printf '%s' "$encoded" | base64 -d >"$stage/$name" || die "the secret '$name' is not valid base64"
    [[ -s "$stage/$name" ]] || die "the secret '$name' is empty in the Vault"
  done

  # The internal PKI: the CA certificate and key come from the Vault and sign fresh leaves; the CA key
  # is then removed. Leaf keys are readable by the container users, inside a 0700 directory.
  cp "$stage/pki_ca_crt" "$pki_stage/ca.crt"
  bash "$here/pki.sh" init "$pki_stage" --ca-key "$stage/pki_ca_key" --key-mode 0444 >/dev/null ||
    die "cannot issue the internal certificates"
  rm -f "$stage/pki_ca_key" "$stage/pki_ca_crt"

  # ca.crt was copied under umask 077 and pki.sh does not touch an existing CA: make it public.
  chmod 0444 "$pki_stage/ca.crt"
  for name in "${GENERATED[@]}" "${DELIVERED[@]}"; do chmod 0444 "$stage/$name"; done
  chmod 0400 "$stage/ocir_pull_token"

  # Hand the files to the deploy user, which runs docker, so it can read them (root runs this unit).
  if [[ "$EUID" -eq 0 ]] && id -u cdag-deploy >/dev/null 2>&1; then owner="cdag-deploy:cdag-deploy"; fi
  if [[ -n "$owner" ]]; then
    chown -R "$owner" "$stage" "$pki_stage"
    mkdir -p "$DOCKER_CONFIG"
    chmod 700 "$DOCKER_CONFIG"
    chown "$owner" "$DOCKER_CONFIG"
  fi

  # Compose mounts these files into containers that run as other users (999, 1000, 10001): the mode
  # of the file is what counts. Everything mounted must be readable by others; ocir_pull_token is
  # only for docker login and is not mounted.
  # (Git Bash on Windows, where the tests also run, has no Unix modes to check.)
  local unreadable=() file mode
  for file in "$stage"/* "$pki_stage"/*; do
    [[ "$(basename "$file")" != ocir_pull_token && "$OSTYPE" != msys* && "$OSTYPE" != cygwin* ]] || continue
    mode="$(stat -c %a "$file")"
    (((8#$mode & 4) != 0)) || unreadable+=("$(basename "$file")")
  done
  ((${#unreadable[@]} == 0)) || die "not readable by the containers: ${unreadable[*]}. Nothing was installed"

  # Swap in only now that every secret was read: a failed fetch never leaves a partial set.
  rm -rf "$CDAG_SECRETS.old" "$CDAG_PKI.old"
  [[ ! -d "$CDAG_SECRETS" ]] || mv "$CDAG_SECRETS" "$CDAG_SECRETS.old"
  [[ ! -d "$CDAG_PKI" ]] || mv "$CDAG_PKI" "$CDAG_PKI.old"
  mv "$stage" "$CDAG_SECRETS"
  mv "$pki_stage" "$CDAG_PKI"
  rm -rf "$CDAG_SECRETS.old" "$CDAG_PKI.old"
  log "fetched ${#FETCH_NAMES[@]} secrets from the Vault into $CDAG_SECRETS and issued the internal certificates"
}

# ---------------------------------------------------------------- operator side

operator_env() {
  load_config
  : "${VAULT_OCID:?set VAULT_OCID (OCID of the vault)}" "${OCI_COMPARTMENT_OCID:?set OCI_COMPARTMENT_OCID}" \
    "${OCI_VAULT_KEY_OCID:?set OCI_VAULT_KEY_OCID (OCID of the vault master encryption key)}"
}

existing_id() { # existing_id <name>: the id of the active secret, empty when there is none
  local id
  id="$(oci vault secret list --compartment-id "$OCI_COMPARTMENT_OCID" --vault-id "$VAULT_OCID" \
    --name "cdag-$1" --lifecycle-state ACTIVE --query 'data[0].id' --raw-output)" || die "cannot list the secrets of the Vault"
  [[ "$id" != null ]] || id=""
  printf '%s' "$id"
}

# store <name> <value-file>: a new secret, or a new version of the one that exists
store() {
  local name="$1" file="$2" id encoded
  encoded="$(base64 <"$file" | tr -d '\n')"
  id="$(existing_id "$name")"
  if [[ -n "$id" ]]; then
    oci vault secret update-base64 --secret-id "$id" --secret-content-content "$encoded" >/dev/null ||
      die "cannot store a new version of '$name'"
    log "stored a new version of $name"
  else
    oci vault secret create-base64 --compartment-id "$OCI_COMPARTMENT_OCID" --vault-id "$VAULT_OCID" \
      --key-id "$OCI_VAULT_KEY_OCID" --secret-name "cdag-$name" --secret-content-content "$encoded" >/dev/null ||
      die "cannot create '$name'"
    log "created $name"
  fi
}

init_generated() {
  operator_env
  local work name value
  work="$(mktemp -d)"
  CLEANUP+=("$work")
  for name in "${GENERATED[@]}"; do
    if [[ -n "$(existing_id "$name")" ]]; then
      log "$name exists: kept"
      continue
    fi
    if [[ "$name" == credentials_master_key ]]; then value="$(openssl rand -base64 32)"; else value="$(openssl rand -hex 24)"; fi
    printf '%s' "$value" >"$work/value"
    store "$name" "$work/value"
  done

  local ca_key_id ca_crt_id
  ca_key_id="$(existing_id pki_ca_key)"
  ca_crt_id="$(existing_id pki_ca_crt)"
  if [[ -n "$ca_key_id" && -n "$ca_crt_id" ]]; then
    log "the internal CA exists: kept"
  elif [[ -n "$ca_key_id" || -n "$ca_crt_id" ]]; then
    die "only one of the CA key and certificate is in the Vault: refusing to create a second CA"
  else
    bash "$here/pki.sh" init "$work/pki" --ca-key "$work/ca.key" >/dev/null
    store pki_ca_key "$work/ca.key"
    store pki_ca_crt "$work/pki/ca.crt"
  fi
}

put() {
  local name="${1:-}" value work
  is_secret_name "$name" || die "unknown secret '$name' (names: ${FETCH_NAMES[*]})" 2
  operator_env
  if [[ -t 0 ]]; then
    read -r -s -p "Value of $name: " value
    echo
  else
    IFS= read -r value || true
  fi
  [[ -n "$value" ]] || die "an empty value is not stored" 2
  work="$(mktemp -d)"
  CLEANUP+=("$work")
  printf '%s' "$value" >"$work/value"
  store "$name" "$work/value"
}

list() {
  operator_env
  local name
  for name in "${FETCH_NAMES[@]}"; do
    if [[ -n "$(existing_id "$name")" ]]; then echo "present  $name"; else echo "MISSING  $name"; fi
  done
}

case "${1:-}" in
  fetch) fetch ;;
  init-generated) init_generated ;;
  put) put "${2:-}" ;;
  list) list ;;
  *) die "usage: secrets.sh fetch | init-generated | put <name> | list" 2 ;;
esac
