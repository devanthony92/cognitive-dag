#!/usr/bin/env bash
# Internal PKI of the deployment (F9, D8A, ADR-0092): a private CA made with openssl and the leaf
# certificates of PostgreSQL, Valkey and Temporal (server, API, worker and UI clients).
#
#   pki.sh init   <pki-dir> [--ca-key <file>] [--key-mode <octal>]   create the CA if missing, issue every leaf
#   pki.sh rotate <pki-dir>  --ca-key <file>  [--key-mode <octal>]   issue every leaf again (new keys), same CA
#   pki.sh status <pki-dir>  [--min-days <n>]   print the days left of each certificate; fail below n
#
# The key of the CA does NOT live next to the leaves: it goes to the file given by --ca-key (default
# <pki-dir>/../ca-private/ca.key). On the VM the provisioning (PR 4) keeps it in the OCI Vault, uses
# it only to run `rotate` and removes it afterwards; this script never prints a key. Leaves last 90
# days, the CA 5 years (contracts/production-env.md). Prints file names and expiry dates only.
# Leaf keys are 0600 by default. The containers read them through a bind mount and run as other
# users, so the deployment passes --key-mode 0444 and keeps the directory itself at 0700.
set -euo pipefail
umask 077

CA_DAYS=1825
LEAF_DAYS=90

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

command="${1:-}"
pki_dir="${2:-}"
[[ -n "$command" && -n "$pki_dir" ]] || usage
shift 2

ca_key=""
min_days=30
key_mode=0600
while (($#)); do
  case "$1" in
    --ca-key) ca_key="${2:?--ca-key needs a file}"; shift 2 ;;
    --key-mode) key_mode="${2:?--key-mode needs an octal mode}"; shift 2 ;;
    --min-days) min_days="${2:?--min-days needs a number}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$min_days" =~ ^[0-9]+$ && "$key_mode" =~ ^0[0-7]{3}$ ]] || usage
mkdir -p "$pki_dir"
pki_dir="$(cd "$pki_dir" && pwd)"
: "${ca_key:=$pki_dir/../ca-private/ca.key}"

# name | subject alternative names | extended key usage
LEAVES=(
  "postgres|DNS:postgres,DNS:localhost|serverAuth"
  "valkey|DNS:valkey,DNS:localhost|serverAuth"
  "temporal|DNS:temporal,DNS:localhost|serverAuth,clientAuth"
  "temporal-client-api|DNS:temporal-client-api|clientAuth"
  "temporal-client-worker|DNS:temporal-client-worker|clientAuth"
  "temporal-client-ui|DNS:temporal-client-ui|clientAuth"
)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

make_ca() {
  mkdir -p "$(dirname "$ca_key")"
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$ca_key" 2>/dev/null
  chmod 600 "$ca_key"
  cat >"$work/ca.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = CognitiveDAG internal CA
[ext]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
CNF
  openssl req -new -x509 -key "$ca_key" -days "$CA_DAYS" -sha256 -config "$work/ca.cnf" \
    -out "$pki_dir/ca.crt"
  chmod 644 "$pki_dir/ca.crt"
}

issue_leaf() {
  local name="$1" san="$2" eku="$3"
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$pki_dir/$name.key" 2>/dev/null
  chmod "$key_mode" "$pki_dir/$name.key"
  cat >"$work/$name.cnf" <<CNF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $name
CNF
  cat >"$work/$name.ext" <<CNF
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = $eku
subjectAltName = $san
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
CNF
  openssl req -new -key "$pki_dir/$name.key" -config "$work/$name.cnf" -out "$work/$name.csr"
  openssl x509 -req -in "$work/$name.csr" -CA "$pki_dir/ca.crt" -CAkey "$ca_key" \
    -set_serial "0x$(openssl rand -hex 16)" -days "$LEAF_DAYS" -sha256 \
    -extfile "$work/$name.ext" -out "$pki_dir/$name.crt" 2>/dev/null
  chmod 644 "$pki_dir/$name.crt"
}

issue_all() {
  local entry name san eku
  for entry in "${LEAVES[@]}"; do
    IFS='|' read -r name san eku <<<"$entry"
    issue_leaf "$name" "$san" "$eku"
    echo "issued $name.crt (valid $LEAF_DAYS days)"
  done
}

case "$command" in
  init)
    if [[ -f "$pki_dir/ca.crt" && -f "$ca_key" ]]; then
      echo "CA exists: kept"
    elif [[ -f "$pki_dir/ca.crt" || -f "$ca_key" ]]; then
      echo "error: only one of ca.crt and the CA key exists; refusing to create a second CA" >&2
      exit 1
    else
      make_ca
      echo "created ca.crt (valid $CA_DAYS days); CA key written to the file given by --ca-key"
    fi
    issue_all
    ;;
  rotate)
    [[ -f "$ca_key" && -f "$pki_dir/ca.crt" ]] || {
      echo "error: rotate needs ca.crt in the PKI directory and the CA key in --ca-key" >&2
      exit 1
    }
    # The CA must verify before anything is replaced.
    openssl x509 -in "$pki_dir/ca.crt" -noout -checkend 0 >/dev/null || {
      echo "error: the CA certificate has expired" >&2
      exit 1
    }
    issue_all
    echo "rotated: restart postgres, valkey, temporal, api, worker and temporal-ui in that order"
    ;;
  status)
    status=0
    for file in "$pki_dir"/ca.crt "$pki_dir"/*.crt; do
      [[ -f "$file" ]] || continue
      end="$(openssl x509 -in "$file" -noout -enddate | cut -d= -f2)"
      if openssl x509 -in "$file" -noout -checkend "$((min_days * 86400))" >/dev/null; then
        state=ok
      else
        state=EXPIRING
        status=1
      fi
      echo "$(basename "$file"): $state (expires $end)"
    done
    exit "$status"
    ;;
  *) usage ;;
esac
