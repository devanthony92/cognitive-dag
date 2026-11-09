#!/usr/bin/env bash
# OWASP ZAP baseline (passive) against the local API and web. F8, decision 6A, FR-013.
#
# Manual on purpose: there is no CI workflow for it. It never sends an active attack, never signs
# in, and refuses any target that is not loopback. Procedure: docs/security/zap.md.
#
#   ZAP_API_URL   API origin        (default http://127.0.0.1:3000)
#   ZAP_WEB_URL   web origin        (default http://127.0.0.1:4173, `vite preview` of the build)
#   ZAP_OUT_DIR   report directory  (default docs/security/zap)
#   ZAP_SPIDER_MINUTES  spider time (default 2)
#   ZAP_DRY_RUN=1 check the targets, print the plan and stop
set -euo pipefail

# Official image (Docker Hub), pinned by digest. Update the digest on purpose, never with a tag.
ZAP_IMAGE="zaproxy/zap-stable@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af"

API_URL="${ZAP_API_URL:-http://127.0.0.1:3000}"
WEB_URL="${ZAP_WEB_URL:-http://127.0.0.1:4173}"
OUT_DIR="${ZAP_OUT_DIR:-docs/security/zap}"
SPIDER_MINUTES="${ZAP_SPIDER_MINUTES:-2}"

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# Only http(s) on localhost, 127.0.0.1 or [::1]. No userinfo, no look-alike host.
LOOPBACK_RE='^https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?/?$'
for pair in "ZAP_API_URL=${API_URL}" "ZAP_WEB_URL=${WEB_URL}"; do
  if [[ ! "${pair#*=}" =~ $LOOPBACK_RE ]]; then
    echo "error: ${pair%%=*} must be a loopback origin (localhost, 127.0.0.1 or [::1]); got '${pair#*=}'" >&2
    exit 2
  fi
done
if [[ ! "${SPIDER_MINUTES}" =~ ^[0-9]{1,2}$ ]]; then
  echo "error: ZAP_SPIDER_MINUTES must be a whole number of minutes" >&2
  exit 2
fi

echo "ZAP baseline (passive, no session, no active scan)"
echo "  image : ${ZAP_IMAGE}"
echo "  api   : ${API_URL}"
echo "  web   : ${WEB_URL}"
echo "  out   : ${OUT_DIR}"
echo "  rate limits: login is progressive per account and the webhook allows 60 hits/min per"
echo "    trigger and 20 bad attempts/100 s per address (RATE_RULES, fixed constants, not env"
echo "    variables). The seed hook sends 5 requests and the spider only issues GET, so no limit is"
echo "    relaxed; production values are untouched."
echo "  network: --network host, loopback only; the worker runs with LLM_ENABLED=false"

CMD=(docker run --rm --network host
  -v "${PWD}/${OUT_DIR}:/zap/wrk:rw"
  -v "${PWD}/.zap:/zap/config:ro"
  -e "ZAP_SEED_API=${API_URL}"
  "${ZAP_IMAGE}" zap-baseline.py
  -t "${WEB_URL}"
  -c /zap/config/rules.tsv
  --hook /zap/config/seed-hook.py
  -m "${SPIDER_MINUTES}" -I
  -r zap-report.html -J zap-report.json -w zap-report.md)

if [[ "${ZAP_DRY_RUN:-}" == "1" ]]; then
  echo "dry run, nothing started:"
  printf '  %q' "${CMD[@]}"
  echo
  exit 0
fi

for url in "${API_URL}/health/live" "${WEB_URL}/"; do
  if ! curl -fsS --max-time 5 "${url}" >/dev/null; then
    echo "error: ${url} does not answer. Start the stack first (docs/security/zap.md)." >&2
    exit 3
  fi
done

mkdir -p "${OUT_DIR}"
chmod a+rwx "${OUT_DIR}" 2>/dev/null || true
"${CMD[@]}" || status=$?
echo "ZAP exit code: ${status:-0} (warnings do not fail the run: -I; the report is the evidence)"

# The report is committed as evidence: stop if a secret from .env ended up in it.
if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    value="${value%\"}"; value="${value#\"}"
    [[ "${key}" =~ (KEY|SECRET|PASSWORD|TOKEN)$ && ${#value} -ge 8 ]] || continue
    if grep -rqF -- "${value}" "${OUT_DIR}"; then
      echo "error: the value of ${key} appears in ${OUT_DIR}; redact it before committing" >&2
      exit 4
    fi
  done < .env
fi
[[ "${status:-0}" == "0" || "${status:-0}" == "2" ]]
