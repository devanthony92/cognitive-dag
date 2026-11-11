#!/usr/bin/env bash
# Provisions a clean Ubuntu or Debian VM, x64 or arm64, up to "ready for the first deploy"
# (F9, T044, FR-016, D16A, ADR-0093). Idempotent: running it again changes nothing that is already
# right. It installs Docker and the tools, creates the deploy user and the directories, clones the
# repository to /opt/cognitive-dag, installs the OCI CLI, hardens SSH and the firewall, and installs
# and enables the systemd units. It does NOT fetch secrets (that needs the Vault and the operator's
# first steps, docs/operations/provisioning.md) and prints no value; it writes nothing inside the
# repository tree and nothing secret to disk.
#
#   sudo deploy/provision/provision.sh
#
# PROVISION_ROOT is a prefix for every path (empty on the VM, a temporary directory in the tests).
set -euo pipefail
export LC_ALL=C

R="${PROVISION_ROOT:-}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PROVISION_ROOT="$R"

if [[ -z "$R" && "$EUID" -ne 0 ]]; then
  echo "provision.sh must run as root (sudo)" >&2
  exit 1
fi

# Constants of the deployment, written by cloud-init (deploy/provision/cloud-init.yaml).
CONFIG="$R/etc/cognitive-dag/cognitive-dag.env"
REPO_URL="${CDAG_REPO_URL:-https://github.com/devanthony92/cognitive-dag.git}"
ROOT_DIR="$R/opt/cognitive-dag"
OCI_CLI_VERSION="${OCI_CLI_VERSION:-3.93.0}"
DEPLOY_USER=cdag-deploy
PACKAGES=(
  ca-certificates curl git openssl jq logrotate
  docker.io docker-compose-v2 docker-buildx
  ufw fail2ban python3-systemd unattended-upgrades
  python3 python3-venv
)

step() { echo "provision: $*"; }

# install_file <source> <destination> <mode>: copies only when the content differs.
install_file() {
  if [[ -f "$2" ]] && cmp -s "$1" "$2"; then return 0; fi
  mkdir -p "$(dirname "$2")"
  cp "$1" "$2"
  chmod "$3" "$2"
}

step "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends "${PACKAGES[@]}"
systemctl enable --now docker

step "deploy user and directories"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
# The docker group is root-equivalent: the deploy user is the one that runs the stack.
usermod -aG docker "$DEPLOY_USER"
mkdir -p "$R/etc/cognitive-dag" "$R/var/lib/cognitive-dag/state" "$R/var/lib/cognitive-dag/dumps" \
  "$R/var/lib/cognitive-dag/alerts" "$R/var/log/cognitive-dag" "$R/usr/local/bin"
chmod 0755 "$R/etc/cognitive-dag"
chmod 0750 "$R/var/lib/cognitive-dag" "$R/var/log/cognitive-dag"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$R/var/lib/cognitive-dag" "$R/var/log/cognitive-dag"

step "repository"
if [[ -d "$ROOT_DIR/.git" ]]; then
  git -C "$ROOT_DIR" fetch --quiet origin main
else
  git clone --quiet --branch main "$REPO_URL" "$ROOT_DIR"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ROOT_DIR"

step "OCI CLI $OCI_CLI_VERSION"
if [[ ! -x "$R/opt/oci-cli/bin/oci" ]]; then
  python3 -m venv "$R/opt/oci-cli"
  "$R/opt/oci-cli/bin/pip" install --quiet "oci-cli==$OCI_CLI_VERSION"
fi
ln -sfn "$R/opt/oci-cli/bin/oci" "$R/usr/local/bin/oci"

step "hardening"
bash "$here/harden.sh"

step "systemd units and log rotation"
for unit in "$here"/systemd/*; do
  install_file "$unit" "$R/etc/systemd/system/$(basename "$unit")" 0644
done
# 90 days of archived logs, compressed (FR-027, D10A): the files come from `alerts.sh archive`.
rotation="$(mktemp)"
cat >"$rotation" <<EOF
/var/log/cognitive-dag/*.log {
    daily
    rotate 90
    compress
    delaycompress
    missingok
    notifempty
    dateext
    create 0640 $DEPLOY_USER $DEPLOY_USER
}
EOF
install_file "$rotation" "$R/etc/logrotate.d/cognitive-dag" 0644
rm -f "$rotation"
systemctl daemon-reload
systemctl enable cognitive-dag-secrets.service cognitive-dag.service cognitive-dag-alerts.timer

step "done"
if [[ ! -f "$CONFIG" ]]; then
  echo "provision: $CONFIG is missing; cloud-init writes it (see deploy/env/cognitive-dag.env.example)"
fi
if [[ ! -f "$R/etc/cognitive-dag/local.env" ]]; then
  echo "provision: next, create /etc/cognitive-dag/local.env (SITE_DOMAIN, ALERT_EMAIL_TO); see docs/operations/provisioning.md"
fi
echo "provision: then load the secrets in the Vault from your machine, start cognitive-dag-secrets and deploy"
