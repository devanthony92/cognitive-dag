#!/bin/sh
# Starts the Temporal server of production (F9, ADR-0091): renders the configuration with the
# database password from its secret file, into a tmpfs, and runs the server on it.
set -eu

[ -s /run/secrets/temporal_db_password ] || { echo "missing secret file: temporal_db_password" >&2; exit 1; }
password="$(tr -d '\r\n' </run/secrets/temporal_db_password)"
# The password is substituted into YAML with sed: only characters that cannot break either.
case "$password" in
  *[!A-Za-z0-9_.-]*) echo "temporal_db_password must use only letters, digits, '_', '.' and '-'" >&2; exit 1 ;;
esac

# The server announces this address to the other roles of the cluster (it binds all interfaces).
broadcast="$(getent hosts "$(hostname)" | awk '{print $1; exit}')"
[ -n "$broadcast" ] || { echo "cannot resolve the address of this container" >&2; exit 1; }

mkdir -p /run/temporal/config
sed -e "s|__TEMPORAL_DB_PASSWORD__|$password|g" -e "s|__BROADCAST_ADDRESS__|$broadcast|g"   /etc/temporal/production.template.yaml >/run/temporal/config/production.yaml
chmod 600 /run/temporal/config/production.yaml

exec temporal-server --config-file /run/temporal/config/production.yaml --allow-no-auth start
