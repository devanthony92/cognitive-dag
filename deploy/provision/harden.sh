#!/usr/bin/env bash
# Hardens the host (F9, T044, FR-016, D15A): SSH with keys only and no root, fail2ban on SSH, a host
# firewall that opens 22, 80 and 443 and nothing else. Called by provision.sh; idempotent.
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

# Oracle's Ubuntu images ship iptables rules that reject everything but SSH. ufw is the host
# firewall here, so the stock file is set aside (kept as .cognitive-dag.bak) and replaced by an
# open policy; ufw has already opened 22, 80 and 443 above.
rules="$R/etc/iptables/rules.v4"
if [[ -f "$rules" ]] && grep -q 'REJECT --reject-with icmp-host-prohibited' "$rules"; then
  echo "harden: replacing the stock Oracle iptables rules (backup: rules.v4.cognitive-dag.bak)"
  cp "$rules" "$rules.cognitive-dag.bak"
  printf '*filter\n:INPUT ACCEPT [0:0]\n:FORWARD ACCEPT [0:0]\n:OUTPUT ACCEPT [0:0]\nCOMMIT\n' >"$rules"
  netfilter-persistent reload || true
fi
echo "harden: done"
