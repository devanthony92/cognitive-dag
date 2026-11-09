#!/bin/sh
# One-shot job (F9, ADR-0091): creates or upgrades the Temporal schemas in the two databases, over
# verified TLS. Idempotent: a second run only applies what is missing.
set -eu

[ -s /run/secrets/temporal_db_password ] || { echo "missing secret file: temporal_db_password" >&2; exit 1; }
SQL_PASSWORD="$(tr -d '\r\n' </run/secrets/temporal_db_password)"
export SQL_PASSWORD

tool() {
  temporal-sql-tool --plugin postgres12_pgx --endpoint postgres --port 5432 --user temporal \
    --tls --tls-ca-file /run/secrets/ca.crt --tls-server-name postgres \
    "$@"
}

schema_dir=/etc/temporal/schema/postgresql/v12
for pair in "temporal:temporal" "temporal_visibility:visibility"; do
  database="${pair%%:*}"
  directory="${pair##*:}"
  # setup-schema fails when the version table already exists; update-schema is the real check.
  tool --database "$database" setup-schema -v 0.0 >/dev/null 2>&1 || true
  tool --database "$database" update-schema -d "$schema_dir/$directory/versioned"
done
echo "temporal schemas up to date"
