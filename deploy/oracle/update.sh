#!/usr/bin/env bash
# Update a T-Walk server set up with setup.sh to the latest code:
#   sudo bash /opt/t-walk/deploy/oracle/update.sh
set -euo pipefail
APP=/opt/t-walk
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
cd "$APP"
sudo -u twalk -H git pull --ff-only
sudo -u twalk -H env npm_config_cache="$APP/.npm" npm ci --no-audit --no-fund --loglevel=error
sudo -u twalk -H npm run build --silent >/dev/null
install -m 644 "$APP/deploy/oracle/t-walk.service" /etc/systemd/system/t-walk.service
systemctl daemon-reload
systemctl restart t-walk
for _ in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:8787/api/health && { echo "Updated to $(git log -1 --format='%h %s')"; exit 0; }; sleep 3; done
echo "Not answering yet: sudo journalctl -u t-walk -f" >&2
exit 1
