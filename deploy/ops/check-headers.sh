#!/usr/bin/env bash
# Checks the security headers of the real site and the HTTP to HTTPS redirect (F9, T048, FR-034).
# deploy.sh runs it after every deployment: with no staging this is the check of the edge contract
# (specs/010-deployment/contracts/edge-headers.md) against the domain that serves the demo.
#
#   check-headers.sh [domain]       the domain defaults to $SITE_DOMAIN
#
# Prints the names of the headers that are missing or wrong and exits 1; prints nothing sensitive.
set -euo pipefail
export LC_ALL=C

domain="${1:-${SITE_DOMAIN:-}}"
if [[ ! "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
  echo "usage: check-headers.sh <domain> (or set SITE_DOMAIN)" >&2
  exit 2
fi

failed=0
bad() {
  echo "check-headers: $*" >&2
  failed=1
}

raw="$(curl --silent --show-error --max-time 20 --proto '=https' -D - -o /dev/null "https://$domain/")" ||
  {
    echo "check-headers: cannot reach https://$domain/" >&2
    exit 1
  }
# Lower-case names, no carriage returns.
headers="$(printf '%s\n' "$raw" | tr -d '\r' | awk -F': ' 'NR == 1 { print; next } { n = tolower($1); sub(/^[^:]*: */, ""); print n ": " $0 }')"

status="$(printf '%s\n' "$headers" | head -n 1)"
[[ "$status" =~ ^HTTP/[0-9.]+\ 2[0-9][0-9] ]] || bad "https://$domain/ answered '${status}', not a 2xx"

value() { # value <header>: the value of the first header with that name, lower-cased
  printf '%s\n' "$headers" | sed -n "s/^$1: //p" | head -n 1 | tr '[:upper:]' '[:lower:]'
}

sts="$(value strict-transport-security)"
if [[ "$sts" =~ max-age=([0-9]+) ]] && ((BASH_REMATCH[1] >= 31536000)); then :; else
  bad "missing or wrong header: strict-transport-security"
fi

csp="$(value content-security-policy)"
if [[ "$csp" == *"default-src 'self'"* && "$csp" == *"script-src 'self'"* &&
  "$csp" == *"frame-ancestors 'none'"* && "$csp" == *"object-src 'none'"* ]]; then :; else
  bad "missing or wrong header: content-security-policy"
fi
if [[ "$csp" =~ script-src[^\;]*\'unsafe-(inline|eval)\' ]]; then
  bad "content-security-policy allows unsafe-inline or unsafe-eval in script-src"
fi

[[ "$(value x-frame-options)" == deny ]] || bad "missing or wrong header: x-frame-options"
[[ "$(value x-content-type-options)" == nosniff ]] || bad "missing or wrong header: x-content-type-options"
[[ "$(value permissions-policy)" == *"camera=()"* ]] || bad "missing or wrong header: permissions-policy"
case "$(value cross-origin-embedder-policy)" in
  require-corp | credentialless) ;;
  *) bad "missing or wrong header: cross-origin-embedder-policy" ;;
esac
[[ "$(value cross-origin-opener-policy)" == same-origin ]] || bad "missing or wrong header: cross-origin-opener-policy"
[[ "$(value cross-origin-resource-policy)" == same-origin ]] || bad "missing or wrong header: cross-origin-resource-policy"
[[ -n "$(value referrer-policy)" ]] || bad "missing header: referrer-policy"
[[ -z "$(value server)" ]] || bad "the server header must not be sent"

# Plain HTTP only redirects, keeping the host and moving to HTTPS.
redirect="$(curl --silent --show-error --max-time 20 --proto '=http' -o /dev/null -w '%{http_code} %{redirect_url}' "http://$domain/")" ||
  redirect=""
code="${redirect%% *}"
target="${redirect#* }"
if [[ "$code" != 301 || "$target" != "https://$domain/"* ]]; then
  bad "http://$domain/ does not redirect to https (got '${code:-none}')"
fi

if ((failed)); then
  echo "check-headers: FAILED for $domain" >&2
  exit 1
fi
echo "check-headers: ok for $domain"
