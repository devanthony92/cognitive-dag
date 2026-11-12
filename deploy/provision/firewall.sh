#!/usr/bin/env bash
# Host firewall rules that ufw does not manage (F9, FR-016, ADR-0097). Run as root:
#
#   firewall.sh apply
#
# It is idempotent and runs at provisioning time (harden.sh) and at every boot and every Docker
# restart (cognitive-dag-firewall.service, ordered after docker.service). It does three things:
#
#   1. Removes the generic REJECT rules that Oracle's Ubuntu image puts at the end of INPUT and
#      FORWARD. They sit before the ufw chains and would block 80 and 443.
#   2. Keeps Oracle's InstanceServices chain (only root may talk to 169.254.0.0/16 services from the
#      host) loaded, from the copy harden.sh saved in /etc/cognitive-dag. Nothing else loads
#      /etc/iptables/rules.v4 once ufw replaces iptables-persistent.
#   3. Blocks the traffic of containers to 169.254.0.0/16 in DOCKER-USER, except DNS to the VCN
#      resolver. Container traffic goes through FORWARD, not OUTPUT, so without this a container
#      could ask the metadata service for the instance principal token (SSRF to the Vault secrets).
set -euo pipefail
export LC_ALL=C

SAVED="${CDAG_INSTANCE_SERVICES:-/etc/cognitive-dag/oracle-instance-services.rules}"
METADATA_NET=169.254.0.0/16
RESOLVER=169.254.169.254/32
CHAIN=COGNITIVE-DAG-METADATA

ipt() { iptables -w "$@"; }

# ensure <iptables args>: appends the rule only when it is not there yet.
ensure() { ipt -C "$@" 2>/dev/null || ipt -A "$@"; }

apply() {
  # 1. Oracle's stock "reject everything else" rules. Bounded loop: a duplicate is removed too.
  for chain in INPUT FORWARD; do
    for _ in 1 2 3 4 5; do
      ipt -D "$chain" -j REJECT --reject-with icmp-host-prohibited 2>/dev/null || break
    done
  done

  # 2. Oracle's InstanceServices chain and the jump from OUTPUT.
  if [[ -s "$SAVED" ]]; then
    iptables-restore --noflush <"$SAVED"
    ensure OUTPUT -d "$METADATA_NET" -j InstanceServices
  else
    echo "firewall: no saved InstanceServices rules ($SAVED); nothing to keep"
  fi

  # 3. Containers cannot reach the metadata service. DOCKER-USER is read first for forwarded
  # traffic and Docker never flushes it; creating it here is safe (Docker reuses it).
  ipt -N DOCKER-USER 2>/dev/null || true
  ipt -N "$CHAIN" 2>/dev/null || true
  ipt -F "$CHAIN"
  for proto in udp tcp; do
    ipt -A "$CHAIN" -d "$RESOLVER" -p "$proto" --dport 53 -j RETURN
  done
  ipt -A "$CHAIN" -d "$METADATA_NET" -j REJECT --reject-with icmp-admin-prohibited
  ipt -C DOCKER-USER -j "$CHAIN" 2>/dev/null || ipt -I DOCKER-USER 1 -j "$CHAIN"
  echo "firewall: applied"
}

case "${1:-}" in
  apply) apply ;;
  *)
    echo "usage: firewall.sh apply" >&2
    exit 2
    ;;
esac
