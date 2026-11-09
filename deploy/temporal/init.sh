#!/bin/sh
# One-shot job (F9, ADR-0091, D15A): creates the namespace with a short retention and the search
# attribute CorrelationId. Idempotent. Talks to the frontend over mTLS with a client certificate of
# the internal CA. The retention is short on purpose: the run history that matters lives in
# PostgreSQL.
set -eu

namespace="${TEMPORAL_NAMESPACE:?TEMPORAL_NAMESPACE is required}"
retention="${TEMPORAL_RETENTION:-72h}"

# The connection options belong to the command, so they go after it.
cli() {
  command="$1"
  shift
  # shellcheck disable=SC2086 # $command is a fixed multi-word command given by this script
  temporal $command "$@" --address temporal:7233 --tls \
    --tls-ca-path /run/secrets/ca.crt \
    --tls-cert-path /run/secrets/temporal-client-ui.crt \
    --tls-key-path /run/secrets/temporal-client-ui.key \
    --tls-server-name temporal
}

if cli "operator namespace describe" --namespace "$namespace" >/dev/null 2>&1; then
  echo "namespace $namespace exists"
else
  cli "operator namespace create" --namespace "$namespace" --retention "$retention"
fi

# A new namespace takes a few seconds to reach every service of the server.
attributes=""
tries=0
until attributes="$(cli "operator search-attribute list" --namespace "$namespace" 2>/dev/null)"; do
  tries=$((tries + 1))
  [ "$tries" -lt 30 ] || { echo "namespace $namespace is not ready" >&2; exit 1; }
  sleep 2
done

if printf "%s" "$attributes" | grep -q "CorrelationId"; then
  echo "search attribute CorrelationId exists"
else
  cli "operator search-attribute create" --namespace "$namespace" --name CorrelationId --type Keyword
fi
