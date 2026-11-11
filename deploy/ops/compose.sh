#!/usr/bin/env bash
# `docker compose` for the production stack, with the configuration, the secrets directory and the
# current version already set (F9, FR-038). For the operator:
#
#   compose.sh ps
#   compose.sh logs --since 30m api
#   compose.sh restart worker
#
# The Compose file needs the image digests and the paths of the secrets; this wrapper supplies them
# the same way deploy.sh does. It prints nothing of its own.
set -euo pipefail
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/lib.sh"

require_config
[[ -f "$STATE_DIR/current.env" ]] || die "no version has been deployed yet"
use_version "$STATE_DIR/current.env"
compose "$@"
