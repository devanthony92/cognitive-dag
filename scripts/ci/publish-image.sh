#!/usr/bin/env bash
# Publishes one image (F9, D1B, D11C): scans each architecture, writes a CycloneDX SBOM per
# architecture, pushes both, combines them into one manifest tagged with the commit SHA, and attaches
# the SBOMs to that manifest. The registry credentials arrive only as environment variables.
#
# Usage: publish-image.sh <image-name>
# Needs: OCIR_REGISTRY OCIR_NAMESPACE OCIR_USERNAME OCIR_TOKEN GIT_SHA, and the OCI layouts in
# ./layouts/<image-name>-<arch>/ (from the build jobs). Writes ./out/<image-name>.* files.
set -euo pipefail

image="${1:?usage: publish-image.sh <image-name>}"
: "${OCIR_REGISTRY:?}" "${OCIR_NAMESPACE:?}" "${OCIR_USERNAME:?}" "${OCIR_TOKEN:?}" "${GIT_SHA:?}"

# Tools run as images pinned by digest (renovate keeps the tag comments current).
GRYPE='anchore/grype:v0.121.2@sha256:6a36234da13f9faa327306ac0b3dab3405cfa2b4eb20c8f904125a8707863913'
SYFT='anchore/syft:v1.57.0@sha256:3c70e6d5979364cefdc22b51617a78fd264574d3bd6b4f84a351204147025e2a'
CRANE='gcr.io/go-containerregistry/crane:v0.22.1@sha256:1f968817b95790bed063f71175aa6b8ff879fa17064020415f3e18bb6e6a36e1'
ORAS='ghcr.io/oras-project/oras:v1.3.6@sha256:9cfb578be975b762fd898b9d004243d8003aeb807a3e15b2ed212cdd1326c9eb'

repository="${OCIR_REGISTRY}/${OCIR_NAMESPACE}/cognitive-dag/${image}"
work="$(pwd)"
mkdir -p out .tool-home/tmp
docker_config="$(mktemp -d)"
trap 'rm -rf "${docker_config}"' EXIT

# Every tool container runs as the runner's own user, so the config directory (mode 0700, owned by
# the runner), out/ and the layouts are readable and writable. The tool images default to other
# users (crane runs as nonroot, uid 65532). HOME and TMPDIR point inside the workspace (the images
# have no writable /tmp for that user) so Grype and Syft can keep their database, cache and
# scratch files there.
run() { # run <image> <args...>: a tool container with the workspace and registry auth mounted
  local tool="$1"
  shift
  docker run --rm -i --user "$(id -u):$(id -g)" \
    -v "${work}:/work" -w /work -e HOME=/work/.tool-home -e TMPDIR=/work/.tool-home/tmp \
    -v "${docker_config}:/dockercfg" -e DOCKER_CONFIG=/dockercfg "${tool}" "$@"
}

printf '%s' "${OCIR_TOKEN}" | run "${CRANE}" auth login "${OCIR_REGISTRY}" \
  --username "${OCIR_USERNAME}" --password-stdin >/dev/null

# 1. Scan and SBOM before anything is pushed: a blocked image never reaches the registry.
for arch in amd64 arm64; do
  layout="layouts/${image}-${arch}"
  test -d "${layout}" || { echo "missing OCI layout ${layout}" >&2; exit 1; }
  run "${GRYPE}" "oci-dir:${layout}" --only-fixed -o json --file "out/${image}-${arch}.grype.json"
  node scripts/ci/check-image-scan.ts "out/${image}-${arch}.grype.json" .github/image-scan-exceptions.json "${image}"
  run "${SYFT}" "oci-dir:${layout}" -o "cyclonedx-json=out/${image}-${arch}.cdx.json"
done

# 2. Push each architecture, then the combined manifest tagged with the commit SHA.
declare -A digest_of
for arch in amd64 arm64; do
  run "${CRANE}" push "layouts/${image}-${arch}" "${repository}:${GIT_SHA}-${arch}"
  digest_of[${arch}]="${repository}@$(run "${CRANE}" digest "${repository}:${GIT_SHA}-${arch}")"
done
run "${CRANE}" index append -t "${repository}:${GIT_SHA}" \
  -m "${digest_of[amd64]}" -m "${digest_of[arm64]}"
index_digest="$(run "${CRANE}" digest "${repository}:${GIT_SHA}")"
published="${repository}@${index_digest}"

# 3. Attach each SBOM to the manifest it describes, so it can be listed with `oras discover`.
for arch in amd64 arm64; do
  run "${ORAS}" attach --artifact-type application/vnd.cyclonedx+json \
    "${digest_of[${arch}]}" "out/${image}-${arch}.cdx.json:application/vnd.cyclonedx+json"
done

printf '%s\n' "${published}" >"out/${image}.ref"
echo "published ${published}"
