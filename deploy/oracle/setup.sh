#!/usr/bin/env bash
# Sets up T-Walk on a fresh Ubuntu 24.04 server (made for Oracle Cloud's free tier,
# works on any Ubuntu box). Run it from the cloned repo, which must be /opt/t-walk:
#
#   sudo git clone https://github.com/flyhighbarney/t-walk.git /opt/t-walk
#   sudo bash /opt/t-walk/deploy/oracle/setup.sh <host name>
#
# <host name> is what HTTPS is issued for: your own domain pointing at the server,
# or the free <public-ip-with-dashes>.sslip.io (e.g. 203-0-113-7.sslip.io).
# Safe to run again: each step checks what's already there.
#
# It: adds swap on small machines, opens ports 80/443 in the server's firewall,
# installs Node 24 and Caddy (HTTPS), creates a `twalk` user, installs and builds
# T-Walk, writes /opt/t-walk/.env if there's none, and starts it as a service.

set -euo pipefail

HOST="${1:?Usage: sudo bash deploy/oracle/setup.sh <host name, e.g. 203-0-113-7.sslip.io>}"
APP=/opt/t-walk
DATA=/var/lib/t-walk
NODE_VERSION="${NODE_VERSION:-v24.15.0}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -f "$APP/package.json" ] || { echo "Clone the repo to $APP first (see the top of this file)." >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

step "Swap (small machines need it to build the app and import the timetable)"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3000 ] && ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "2 GB swap added (${MEM_MB} MB memory)."
else
  echo "Not needed or already there."
fi

step "Packages: curl, xz, git, Caddy, iptables-persistent"
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl xz-utils git caddy iptables-persistent >/dev/null

step "Firewall: let web traffic in (Oracle's Ubuntu image only allows SSH)"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null ||
    iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null ||
    iptables -I INPUT 5 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
done
netfilter-persistent save >/dev/null

step "Node $NODE_VERSION"
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) echo "Unsupported CPU $(uname -m)" >&2; exit 1 ;; esac
if [ "$(node -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$ARCH.tar.xz" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
fi
node -v

step "The twalk user and folders"
id twalk >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin twalk
mkdir -p "$DATA"
chown -R twalk:twalk "$APP" "$DATA"
git config --system --add safe.directory "$APP" 2>/dev/null || true

step "Install and build (a few minutes on a small machine)"
sudo -u twalk -H env npm_config_cache="$APP/.npm" npm ci --no-audit --no-fund --loglevel=error
sudo -u twalk -H npm run build --silent >/dev/null
echo "Web app built into $APP/apps/web/dist."

step "Settings: $APP/.env"
if [ ! -f "$APP/.env" ]; then
  cat > "$APP/.env" <<'ENV'
# T-Walk settings. After changing them: sudo systemctl restart t-walk

# MBTA V3 API key (free, https://api-v3.mbta.com/portal). Optional: without it,
# T-Walk polls the MBTA's public real-time feeds every 10 s instead of streaming.
MBTA_API_KEY=

# Sent in the User-Agent to the MBTA and api.weather.gov, which ask for a contact.
CONTACT=t-walk (https://github.com/flyhighbarney/t-walk)

# Trip planning: "off" uses the built-in planner (fits in 1 GB). Point it at an
# OpenTripPlanner server (e.g. http://127.0.0.1:8080) for street-by-street walks;
# T-Walk falls back to the built-in planner whenever OTP doesn't answer.
OTP_URL=off
ENV
  chown twalk:twalk "$APP/.env"
  chmod 600 "$APP/.env"
  echo "Written. Add your MBTA key there if you have one."
else
  echo "Already there; left alone."
fi
grep -q '^VAPID_PUBLIC_KEY=' "$APP/.env" || (cd "$APP" && sudo -u twalk -H npm run push:keys --silent)

step "Service"
install -m 644 "$APP/deploy/oracle/t-walk.service" /etc/systemd/system/t-walk.service
systemctl daemon-reload
systemctl enable t-walk >/dev/null 2>&1
systemctl restart t-walk

step "HTTPS for $HOST (Caddy gets a free Let's Encrypt certificate)"
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
	reverse_proxy 127.0.0.1:8787
}
CADDY
systemctl reload caddy 2>/dev/null || systemctl restart caddy

step "Waiting for T-Walk (the first start downloads and imports the MBTA timetable: 1-3 minutes)"
for _ in $(seq 1 90); do
  if curl -sf -o /dev/null http://127.0.0.1:8787/api/health; then
    echo "T-Walk is up: https://$HOST"
    exit 0
  fi
  sleep 5
done
echo "Still starting. Watch it with: sudo journalctl -u t-walk -f" >&2
exit 1
