#!/usr/bin/env bash
# Sunucu kaynak ölçümü (AD10): disk (/), RAM, yük ortalaması ve docker konteyner durumu → public.host_metrics.
# Dakikada bir cron ile çalışır; /admin/sistem?sekme=kaynaklar bu tabloyu okur, uyarı motoru "disk doluyor"
# kuralını son satırdan değerlendirir (ölçüm 15 dk'dan eskiyse kural değerlendirilmez).
# Uygulama konteyneri docker soketine ERİŞMEZ; ölçüm yalnız burada, sunucuda alınır. Saklama uyarı motorunda (ayar).
#
# Kurulum (tek sefer, root):  scripts/sunucu/host-metrics.sh --install   → /etc/cron.d/emlaksoft-host-metrics
# Elle deneme:               scripts/sunucu/host-metrics.sh --print     → yazmadan JSON satırını gösterir
set -euo pipefail
DB=supabase-db-moqbebljyeyprktd19zb1ihn
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

if [ "${1:-}" = "--install" ]; then
  cat > /etc/cron.d/emlaksoft-host-metrics <<CRON
# OTOMATİK: scripts/sunucu/host-metrics.sh --install — sunucu kaynak ölçümü (dakikada bir)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
* * * * * root $SELF >> /var/log/emlaksoft-host-metrics.log 2>&1
CRON
  chmod 644 /etc/cron.d/emlaksoft-host-metrics
  cat > /etc/logrotate.d/emlaksoft-host-metrics <<'R'
/var/log/emlaksoft-host-metrics.log {
  weekly
  rotate 4
  compress
  missingok
  notifempty
}
R
  echo "host-metrics cron kuruldu (/etc/cron.d/emlaksoft-host-metrics)"
  exit 0
fi

# Disk: kök dosya sistemi (bayt)
read -r DISK_TOTAL DISK_USED < <(df -B1 --output=size,used / | tail -1 | awk '{print $1, $2}')
# RAM: MemTotal - MemAvailable (kB → bayt)
MEM_TOTAL=$(awk '/^MemTotal:/ {print $2 * 1024}' /proc/meminfo)
MEM_AVAIL=$(awk '/^MemAvailable:/ {print $2 * 1024}' /proc/meminfo)
read -r L1 L5 L15 _ < /proc/loadavg
CPUS=$(nproc)
# Konteynerler: ad, durum (running/exited…), docker durum metni (Up 3 days (healthy)…), imaj.
# KQ4: çıktı HER ZAMAN tek geçerli JSON dizisidir. Eskiden docker hata verince pipefail ile `|| echo '[]'` Python'un
# kendi "[]" çıktısına eklenip "[]\n[]" (geçersiz jsonb) oluyor ve satır hiç yazılmıyordu. Artık docker çıktısı ayrı
# alınır, ayrıştırma hatası "[]" verir ve sonuç yazmadan önce bir kez daha doğrulanır.
containers_json() {
  local raw out
  raw=$(docker ps -a --format '{{json .}}' 2>/dev/null) || raw=""
  out=$(printf '%s\n' "$raw" | python3 -I -c '
import sys, json
out = []
for line in sys.stdin:
    try:
        c = json.loads(line)
    except ValueError:
        continue
    if not isinstance(c, dict):
        continue
    status = str(c.get("Status") or "")
    health = "healthy" if "(healthy)" in status else "unhealthy" if "(unhealthy)" in status else None
    out.append({"name": str(c.get("Names") or "")[:80], "state": str(c.get("State") or "")[:20], "status": status[:80],
                "health": health, "image": str(c.get("Image") or "")[:120]})
out.sort(key=lambda c: (c["state"] == "running", c["name"]))
print(json.dumps(out[:80]))
' 2>/dev/null) || out=""
  if printf '%s' "$out" | python3 -I -c 'import sys, json; v = json.loads(sys.stdin.read()); sys.exit(0 if isinstance(v, list) else 1)' 2>/dev/null; then
    printf '%s' "$out"
  else
    printf '[]'
  fi
}
CONTAINERS=$(containers_json)

ROW=$(python3 -I -c '
import json, sys
dt, du, mt, ma, l1, l5, l15, cpus = sys.argv[1:9]
dt, du, mt, ma = int(dt), int(du), int(mt), int(ma)
print(json.dumps({
  "host": sys.argv[9][:80],
  "disk_total_bytes": dt, "disk_used_bytes": du, "disk_used_pct": round(du * 100 / dt, 2) if dt else None,
  "mem_total_bytes": mt, "mem_used_bytes": mt - ma, "mem_used_pct": round((mt - ma) * 100 / mt, 2) if mt else None,
  "load1": float(l1), "load5": float(l5), "load15": float(l15), "cpu_count": int(cpus),
}))' "$DISK_TOTAL" "$DISK_USED" "$MEM_TOTAL" "$MEM_AVAIL" "$L1" "$L5" "$L15" "$CPUS" "$(hostname -s)")

if [ "${1:-}" = "--print" ]; then
  printf '%s\n%s\n' "$ROW" "$CONTAINERS"
  exit 0
fi

# Tablo yoksa (migration 20261013004900 bekliyor) sessizce çık.
HAS=$(docker exec "$DB" psql -U postgres -d postgres -Atc "select pg_catalog.to_regclass('public.host_metrics') is not null")
[ "$HAS" = "t" ] || exit 0
# Değerler psql değişkeni olarak geçer (:'ad' tırnaklaması psql'de; SQL'e metin birleştirilmez).
docker exec -i "$DB" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -v row="$ROW" -v containers="$CONTAINERS" <<'SQL' >/dev/null
insert into public.host_metrics (host, disk_total_bytes, disk_used_bytes, disk_used_pct, mem_total_bytes, mem_used_bytes,
                                 mem_used_pct, load1, load5, load15, cpu_count, containers)
select r->>'host', (r->>'disk_total_bytes')::bigint, (r->>'disk_used_bytes')::bigint, (r->>'disk_used_pct')::numeric,
       (r->>'mem_total_bytes')::bigint, (r->>'mem_used_bytes')::bigint, (r->>'mem_used_pct')::numeric,
       (r->>'load1')::numeric, (r->>'load5')::numeric, (r->>'load15')::numeric, (r->>'cpu_count')::int,
       :'containers'::jsonb
from (select :'row'::jsonb as r) s;
SQL
