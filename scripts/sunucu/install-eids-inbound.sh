#!/usr/bin/env bash
# EİDS posta alıcısı kurulumu / güncellemesi (EP3). Depo kökünden çalıştırılır: bash scripts/sunucu/install-eids-inbound.sh
#
# ÖN KOŞULLAR (sahip işi; bu betik YAPMAZ):
#   1) DNS:  eids.emlaksoft.com.tr  MX 10  mx.emlaksoft.com.tr
#            mx.emlaksoft.com.tr    A      178.105.169.160
#   2) Hetzner güvenlik duvarı: gelen TCP 25 açık (giden 25 GEREKMEZ; alıcı posta göndermez).
#   3) Ortak köprü anahtarı: EIDS_INBOUND_SECRET (>=32 karakter, ör. `openssl rand -hex 32`) hem .env.production'a
#      (uygulama) hem /srv/emlaksoft/eids-inbound.env'e (yalnız bu satır) yazılır. Uygulama ayrıca EIDS_MAIL_KEY ister
#      (64 hex; adres ve ham e-posta şifrelemesi) — bu anahtar alıcıya VERİLMEZ. Uygulama yeniden yayınlanmalı.
#
# Betik: imajı derler, konteyneri `eids` profiliyle başlatır, 25 numaralı portun dinlendiğini ve açık röle olmadığını
# denetler. deploy.sh bu servisi başlatmaz/durdurmaz (profilli); güncelleme için bu betik yeniden çalıştırılır.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ENV_FILE=/srv/emlaksoft/eids-inbound.env
TAG="$(date +%Y%m%d%H%M%S)"

if [[ ! -f "$ENV_FILE" ]] || ! grep -Eq '^EIDS_INBOUND_SECRET=.{32,}$' "$ENV_FILE"; then
  echo "HATA: $ENV_FILE içinde en az 32 karakterlik EIDS_INBOUND_SECRET yok." >&2
  echo "  Örnek: umask 077; echo \"EIDS_INBOUND_SECRET=\$(openssl rand -hex 32)\" > $ENV_FILE  (aynı değeri .env.production'a da yazın)" >&2
  exit 1
fi
chmod 600 "$ENV_FILE"

if ss -ltn '( sport = :25 )' | grep -q LISTEN && ! docker ps --format '{{.Names}}' | grep -qx emlaksoft-eids-inbound; then
  echo "HATA: 25 numaralı port başka bir süreç tarafından kullanılıyor (postfix/exim?). Önce onu durdurun." >&2
  exit 1
fi

echo "== İmaj derleniyor (emlaksoft-eids-inbound:$TAG)"
docker build -t "emlaksoft-eids-inbound:$TAG" -t emlaksoft-eids-inbound:latest infra/eids-inbound

echo "== Konteyner başlatılıyor"
EIDS_TAG="$TAG" docker compose -f deploy/compose.prod.yml --profile eids up -d eids-inbound

sleep 3
echo "== Denetim"
if ! docker ps --format '{{.Names}}' | grep -qx emlaksoft-eids-inbound; then
  echo "HATA: konteyner çalışmıyor; günlük: docker logs emlaksoft-eids-inbound" >&2
  exit 1
fi
# Açık röle testi: dış alan adına RCPT 550 almalı.
RELAY="$(printf 'EHLO kurulum-testi\r\nMAIL FROM:<test@example.com>\r\nRCPT TO:<test@gmail.com>\r\nQUIT\r\n' | timeout 10 nc -q 3 127.0.0.1 25 || true)"
if echo "$RELAY" | grep -q '^550'; then
  echo "OK: açık röle değil (dış adrese RCPT 550)."
else
  echo "UYARI: röle testi beklenen 550'yi döndürmedi:" >&2
  echo "$RELAY" >&2
  exit 1
fi
echo "Tamam. Dışarıdan doğrulama: başka bir makineden 'nc mx.emlaksoft.com.tr 25' banner'ı görmeli."
