#!/bin/sh
# PostgreSQL refuses a private key that group or others can read. The secret is a bind-mounted file
# whose permissions come from the host (readable by the container users), so the key is copied to a
# tmpfs with mode 0600, owned by this user, before the stock entrypoint starts the server.
set -eu

[ -s /run/secrets/postgres.key ] || { echo "missing secret file: postgres.key" >&2; exit 1; }
install -d -m 0700 /run/postgres-tls
umask 077
cat /run/secrets/postgres.key >/run/postgres-tls/server.key
chmod 0600 /run/postgres-tls/server.key

exec docker-entrypoint.sh "$@"
