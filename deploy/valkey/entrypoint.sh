#!/bin/sh
# Builds the ACL file from the secret password and starts Valkey (F9, FR-010). The file lives in a
# tmpfs; only the SHA-256 of the password is written, never the password.
set -eu

user="${VALKEY_USERNAME:?VALKEY_USERNAME is required}"
[ -s /run/secrets/valkey_password ] || { echo "missing secret file: valkey_password" >&2; exit 1; }
hash="$(tr -d '\r\n' </run/secrets/valkey_password | sha256sum | cut -d' ' -f1)"

# The exact commands of the application, pinned by apps/api/test/integration/valkey-acl.test.ts
# (VALKEY_ALLOWED_COMMANDS): a command that is not here is refused with NOPERM.
commands="auth del eval evalsha expire get hget hmget hset incr incrby info ping pttl publish set subscribe time unsubscribe zadd zcard zremrangebyscore"
rules=""
for command in $commands; do rules="$rules +$command"; done

umask 077
{
  echo "user default off"
  echo "user $user on #$hash ~* resetchannels &run:* -@all$rules"
} >/run/valkey/users.acl

exec valkey-server /etc/valkey/valkey.conf
