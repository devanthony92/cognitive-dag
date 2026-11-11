#!/usr/bin/env bash
# Deploys one commit to this VM (F9, T046, FR-024, FR-025, D3C, D17A, ADR-0094).
#
#   deploy.sh <git-sha>     the 40-hex SHA of a commit on main whose images the release published
#   deploy.sh --resume      bring the current version up again (boot, after the secrets are back)
#
# Steps: check the SHA is on main, resolve the four images to digests in the registry, dump the
# database (last 3 kept, on this VM only: it is a deployment safety net, not a backup), run the
# migrator, start the services, wait for health, check the headers of the real site. If any step
# after the dump fails the script goes back to the previous version by itself and exits with an
# error. `current.env` and `previous.env` in the state directory hold the digests of each version.
# Migrations are expand/contract: the previous code runs on the new schema, nothing is migrated back.
# Nothing here prints a secret; the registry token goes to `docker login` by standard input.
set -euo pipefail
umask 077
export LC_ALL=C

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/lib.sh"

IMAGES=(api worker edge migrator)

check_headers() { bash "$here/check-headers.sh" "$SITE_DOMAIN"; }

up_all() { compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" --remove-orphans; }

lock() {
  local dir="$STATE_DIR/deploy.lock"
  if ! mkdir "$dir" 2>/dev/null; then
    local holder
    holder="$(cat "$dir/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
      die "another deploy holds the lock ($dir, pid $holder)"
    fi
    rm -rf "$dir"
    mkdir "$dir" || die "cannot take the deploy lock at $dir"
  fi
  echo "$$" >"$dir/pid"
  trap 'rm -rf "$STATE_DIR/deploy.lock"' EXIT
}

record() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$STATE_DIR/deploy.log"; }

# Goes back to current.env (the version that was running); with none, stops what faces the public.
revert() {
  log "deploy failed: $1"
  record "failed ${sha:-unknown}: $1"
  if [[ -f "$STATE_DIR/current.env" ]]; then
    log "rolling back to $(state_value current.env GIT_SHA)"
    use_version "$STATE_DIR/current.env"
    if up_all && check_headers; then
      log "rolled back: the previous version is healthy"
      record "rolled back to $(state_value current.env GIT_SHA)"
    else
      log "ROLLBACK FAILED: the stack is not healthy, see 'docs/operations/deploy.md'"
      record "rollback failed"
    fi
  else
    log "there is no previous version to go back to: stopping edge, api and worker"
    compose stop edge api worker || true
  fi
  rm -f "$STATE_DIR/candidate.env"
  exit 1
}

resolve_digest() { # resolve_digest <image> <sha>
  local reference="$OCIR_REGISTRY/$OCIR_NAMESPACE/cognitive-dag/$1" digest
  digest="$(docker buildx imagetools inspect "$reference:$2" --format '{{.Manifest.Digest}}')" ||
    die "cannot resolve $1 for $2: was it published?"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "unexpected digest for $1"
  printf '%s@%s' "$reference" "$digest"
}

prune_dumps() {
  local dumps index=0 file
  mapfile -t dumps < <(find "$DUMP_DIR" -maxdepth 1 -name 'predeploy-*.dump' | sort -r)
  for file in "${dumps[@]}"; do
    index=$((index + 1))
    if ((index > 3)); then rm -f "$file"; fi
  done
}

main() {
  local mode="${1:-}" sha=""
  case "$mode" in
    --resume) ;;
    *)
      sha="$mode"
      [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "usage: deploy.sh <40-hex git sha> | --resume" 2
      ;;
  esac

  require_config
  ensure_dirs
  require_secrets
  lock

  if [[ "$mode" == --resume ]]; then
    [[ -f "$STATE_DIR/current.env" ]] || die "no current version to resume"
    use_version "$STATE_DIR/current.env"
    sha="$(state_value current.env GIT_SHA)"
    log "resuming $sha"
    up_all
    return
  fi

  : "${OCIR_REGISTRY:?}" "${OCIR_NAMESPACE:?}" "${OCIR_PULL_USER:?}"

  # Only a commit that is on main can be deployed, whatever the caller asks for.
  git -C "$CDAG_ROOT" fetch --quiet origin main
  git -C "$CDAG_ROOT" merge-base --is-ancestor "$sha" origin/main ||
    die "$sha is not a commit of main: refusing to deploy it"
  git -C "$CDAG_ROOT" checkout --quiet --detach "$sha"

  docker login "$OCIR_REGISTRY" --username "$OCIR_PULL_USER" --password-stdin \
    <"$CDAG_SECRETS/ocir_pull_token" >/dev/null || die "cannot log in to $OCIR_REGISTRY"

  local candidate="$STATE_DIR/candidate.env" image
  {
    for image in "${IMAGES[@]}"; do
      printf '%s_IMAGE=%s\n' "${image^^}" "$(resolve_digest "$image" "$sha")"
    done
    printf 'GIT_SHA=%s\n' "$sha"
  } >"$candidate"
  log "deploying $sha"

  local old_sha=""
  old_sha="$(state_value current.env GIT_SHA)"

  # The dump comes first, while the old version still runs on its own schema.
  use_version "${old_sha:+$STATE_DIR/current.env}"
  if [[ -n "$old_sha" ]] && compose ps --services --status running | grep -qx postgres; then
    local dump
    dump="$DUMP_DIR/predeploy-$(date -u +%Y%m%dT%H%M%SZ)-${old_sha:-none}.dump"
    if ! compose exec -T postgres pg_dump -U postgres -Fc cognitive_dag >"$dump" || [[ ! -s "$dump" ]]; then
      rm -f "$dump" "$candidate"
      die "the dump before the migration failed: nothing was changed"
    fi
    log "dump kept at $dump"
    prune_dumps
  else
    log "no database is running: no dump"
  fi

  use_version "$candidate"
  compose pull --quiet "${IMAGES[@]}" || revert "cannot pull the images"
  compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" postgres || revert "postgres did not become healthy"
  compose run --rm migrator </dev/null || revert "the migration failed"
  up_all || revert "the services did not become healthy"
  check_headers || revert "the headers of the real site do not match the contract"

  if [[ -f "$STATE_DIR/current.env" ]]; then cp "$STATE_DIR/current.env" "$STATE_DIR/previous.env"; fi
  mv "$candidate" "$STATE_DIR/current.env"
  record "deployed $sha"
  log "deployed $sha"
}

# The checkout in main() can replace this very file, and bash reads a script as it runs: the whole
# call is one line so that nothing is read from the file after the checkout.
{ main "$@"; exit; }
