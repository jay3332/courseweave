#!/bin/sh
# Copies deploy/out, the catalog and the service files to the server and restarts the service. Run build.sh first.
#   CATALOG=path/to/catalog.sqlite deploy/deploy.sh
# The server needs nothing installed beyond systemd; secrets live only there, in ~/courses/secrets.env.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
host=${DEPLOY_HOST:-adapt}
catalog=${CATALOG:-$root/data/catalog/catalog.sqlite}
[ -f "$root/deploy/out/courses-web-api" ] || { echo "Run deploy/build.sh first." >&2; exit 1; }
[ -f "$catalog" ] || { echo "No catalog at $catalog; build one with courses-index or set CATALOG." >&2; exit 1; }

ssh "$host" 'mkdir -p ~/courses/bin ~/courses/catalog ~/courses/data ~/courses/backups ~/.config/systemd/user'

# The site replaces the old one whole; the binary and the catalog land beside the running ones, then swap in.
tar -C "$root/deploy/out" -czf - site | ssh "$host" 'rm -rf ~/courses/site.new && mkdir ~/courses/site.new && tar -C ~/courses/site.new --strip-components=1 -xzf -'
ssh "$host" 'cat > ~/courses/bin/courses-web-api.new && chmod +x ~/courses/bin/courses-web-api.new' < "$root/deploy/out/courses-web-api"
ssh "$host" 'cat > ~/courses/catalog/catalog.sqlite.new' < "$catalog"
tar -C "$root/deploy" -czf - courses.env secrets.env.example backup.py | ssh "$host" 'tar -C ~/courses -xzf -'
tar -C "$root/deploy" -czf - courses.service courses-backup.service courses-backup.timer \
  | ssh "$host" 'tar -C ~/.config/systemd/user -xzf -'

ssh "$host" 'set -e
cd ~/courses
rm -rf site.old; [ -d site ] && mv site site.old; mv site.new site; rm -rf site.old
mv bin/courses-web-api.new bin/courses-web-api
mv catalog/catalog.sqlite.new catalog/catalog.sqlite
if [ ! -f secrets.env ]; then
  cp secrets.env.example secrets.env
  chmod 600 secrets.env
fi
systemctl --user daemon-reload
systemctl --user enable -q courses.service courses-backup.timer
if grep -qE "^[A-Z_]+=$" secrets.env; then
  echo "Fill in ~/courses/secrets.env on the server, then run: systemctl --user restart courses"
else
  systemctl --user restart courses.service courses-backup.timer
  sleep 2
  systemctl --user --no-pager --lines=5 status courses.service | head -12
fi'
