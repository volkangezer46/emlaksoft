#!/usr/bin/env bash
# Anlık hata akışı servisini kurar/yeniler (scripts/sunucu/error-watch.sh). Günlük döndürme dahil.
set -euo pipefail
cd "$(dirname "$0")/../.."
cat > /etc/systemd/system/emlaksoft-error-watch.service <<UNIT
[Unit]
Description=EmlakSoft anlık hata akışı (error_logs → /var/log/emlaksoft/hatalar.jsonl)
After=docker.service
Requires=docker.service

[Service]
ExecStart=$(pwd)/scripts/sunucu/error-watch.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/logrotate.d/emlaksoft-errors <<'R'
/var/log/emlaksoft/hatalar.jsonl {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
R
systemctl daemon-reload
systemctl enable --now emlaksoft-error-watch.service
systemctl restart emlaksoft-error-watch.service
systemctl --no-pager --lines=0 status emlaksoft-error-watch.service | head -3
