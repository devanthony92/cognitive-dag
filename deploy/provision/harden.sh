#!/usr/bin/env bash
# Hardens the host (F9, T044, FR-016, D15A): SSH with keys only and no root, fail2ban on SSH, a host
# firewall that opens 22, 80 and 443 and nothing else, plus the rules ufw does not manage
# (firewall.sh). Called by provision.sh; idempotent.
#
# PROVISION_ROOT is a prefix for every path (empty on the VM, a temporary directory in the tests).
# Docker publishes ports around ufw, which is why the Compose file publishes only 80 and 443 and
# binds the Temporal UI to 127.0.0.1 (deploy/compose.prod.yaml): the firewall is a second layer.
set -euo pipefail
export LC_ALL=C

R="${PROVISION_ROOT:-}"
SSH_ALLOW_USERS="${SSH_ALLOW_USERS:-ubuntu cdag-deploy}"

# write_if_changed <path> <mode>: the new content comes on standard input; returns 0 if it changed.
write_if_changed() {
  local path="$1" mode="$2" tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if [[ -f "$path" ]] && cmp -s "$tmp" "$path"; then
    rm -f "$tmp"
    return 1
  fi
  mkdir -p "$(dirname "$path")"
  cp "$tmp" "$path"
  chmod "$mode" "$path"
  rm -f "$tmp"
}

echo "harden: ssh"
if write_if_changed "$R/etc/ssh/sshd_config.d/10-cognitive-dag.conf" 0644 <<EOF; then
# Managed by deploy/provision/harden.sh. The first value of a keyword wins and this file is read first.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowUsers $SSH_ALLOW_USERS
EOF
  # A bad drop-in must not lock the operator out: validate before reloading.
  sshd -t
  systemctl reload ssh
fi

echo "harden: fail2ban"
if write_if_changed "$R/etc/fail2ban/jail.d/cognitive-dag.local" 0644 <<'EOF'; then
# Managed by deploy/provision/harden.sh.
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
  systemctl restart fail2ban
fi
systemctl enable --now fail2ban

echo "harden: firewall"
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Oracle's Ubuntu images ship iptables rules (iptables-persistent) that reject everything but SSH
# and a chain, InstanceServices, that limits who talks to 169.254.0.0/16. Installing ufw removes
# iptables-persistent, so nothing loads /etc/iptables/rules.v4 any more and that file is left alone.
# The InstanceServices rules are saved once, from the live rules or from the stock file, and
# firewall.sh puts them back at every boot; it also drops the generic REJECTs and blocks the
# containers' access to the metadata service (ADR-0097).
saved="$R/etc/cognitive-dag/oracle-instance-services.rules"
if [[ ! -s "$saved" ]]; then
  lines="$(iptables-save -t filter 2>/dev/null | grep -E '^-A InstanceServices ' || true)"
  for stock in "$R/etc/iptables/rules.v4" "$R/etc/iptables/rules.v4.cognitive-dag.bak"; do
    [[ -n "$lines" || ! -f "$stock" ]] && continue
    lines="$(grep -E '^-A InstanceServices ' "$stock" || true)"
  done
  if [[ -n "$lines" ]]; then
    echo "harden: saving Oracle's InstanceServices rules to $saved"
    write_if_changed "$saved" 0644 <<EOF || true
# Managed by deploy/provision/harden.sh: Oracle's InstanceServices chain, loaded by firewall.sh.
*filter
:InstanceServices - [0:0]
$lines
COMMIT
EOF
  else
    echo "harden: no Oracle InstanceServices rules found; nothing to keep"
  fi
fi
CDAG_INSTANCE_SERVICES="$saved" bash "$(dirname "${BASH_SOURCE[0]}")/firewall.sh" apply
echo "harden: done"
