#!/usr/bin/env bash
# Creates an authorised account (F9, T051, D23A). Registration is closed at the edge (Caddy answers
# 404 to POST /api/v1/auth/register), so the operator registers people from the VM, through the API
# inside the Compose network, which the edge rule does not cover:
#
#   create-account.sh <email> <name>        the password is read from standard input
#
# The password comes from a terminal prompt (hidden) or from a pipe, never from an argument, and is
# passed to the container by standard input. The API applies its own password policy (8 to 25
# characters), sends the verification mail and answers 202 whether or not the address existed; the
# person finishes with the link of that mail. Accepting an invitation does not go through register
# (POST /api/v1/invitations/accept), so invitations keep working for people who already have one.
set -euo pipefail
umask 077
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/lib.sh"

email="${1:-}"
name="${2:-}"
[[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ && -n "$name" ]] ||
  die "usage: create-account.sh <email> <name>  (password on standard input)" 2

if [[ -t 0 ]]; then
  read -r -s -p "Password for $email: " password
  echo
else
  IFS= read -r password || true
fi
[[ -n "$password" ]] || die "an empty password is not accepted" 2

require_config
if [[ -f "$STATE_DIR/current.env" ]]; then use_version "$STATE_DIR/current.env"; fi

# The body is built inside the container from standard input, so nothing secret is an argument.
status="$(
  printf '%s\n%s\n%s\n' "$email" "$name" "$password" |
    compose exec -T api node -e '
      const lines = require("node:fs").readFileSync(0, "utf8").split("\n");
      const [email, name, password] = lines;
      fetch("http://127.0.0.1:3000/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name, password }),
      }).then((response) => console.log(response.status), () => console.log("error"));
    '
)" || die "cannot reach the api container"

case "$status" in
  202) log "accepted: $email will receive the verification mail" ;;
  422) die "the API refused the data (password policy: 8 to 25 characters, or an invalid email or name)" ;;
  429) die "rate limited: wait and try again" ;;
  *) die "unexpected answer from the API: $status" ;;
esac
