#!/usr/bin/env bash
# Forced command of the deploy key (F9, T047, D3C, ADR-0094). deploy.yml connects as cdag-deploy with a
# key whose line in authorized_keys is
#
#   restrict,command="/opt/cognitive-dag/deploy/ops/ssh-deploy.sh" ssh-ed25519 AAAA... deploy
#
# so the only thing that key can do is run this script, with the command the client asked for in
# SSH_ORIGINAL_COMMAND. Only `deploy <40-hex sha>` is accepted; anything else is refused. deploy.sh
# then checks that the commit is on main and that its images exist. No shell, no forwarding, no pty.
set -euo pipefail
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
request="${SSH_ORIGINAL_COMMAND:-}"

if [[ ! "$request" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  echo "ssh-deploy: refused: the only command this key can run is 'deploy <40-hex sha>'" >&2
  exit 2
fi

exec bash "$here/deploy.sh" "${BASH_REMATCH[1]}"
