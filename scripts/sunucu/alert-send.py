#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sunucu tarafı uyarı gönderici (AD10). error-watch.sh kesinti/düzelme anında çağırır.

NEDEN SUNUCUDA: site çöktüğünde uygulama kendi kesintisini bildiremez. Bu betik uygulamaya hiç bağlı değildir:
kanalları (alert_channels) DB'den okur, şifreli yapılandırmayı uygulama ile AYNI anahtarla çözer
(src/lib/platform-secrets.ts: PLATFORM_SECRETS_KEY ya da OTP_HMAC_SECRET… kaynaklı HKDF-SHA256; AES-256-GCM,
AAD = "platform_settings:alert_channel:<id>") ve Telegram / webhook / e-posta (Resend) gönderir.

DB de çöktüyse: son başarılı okumanın ŞİFRELİ kopyası (/run/emlaksoft/alert-channels.json, tmpfs, 0600) kullanılır;
diske düz sır yazılmaz. Olay kaydı DB erişilebilirse alert_events'e (source='host') yazılır/kapatılır.

Kullanım:
  alert-send.py refresh                         # kanal/kural önbelleğini tazeler (error-watch 5 dk'da bir)
  alert-send.py rule                            # health_down kuralını "enabled threshold muted repeat_dk" yazdırır
  alert-send.py fire  --title T --body B        # kesinti uyarısı (kural sessizse yalnız kayıt)
  alert-send.py fire  --reminder 1 ...          # kesinti sürüyor hatırlatması (tekrar aralığı dolunca)
  alert-send.py resolve --title T --body B      # düzeldi mesajı (yalnız uyarı gönderildiyse)
Sahte gönderim yok: kanal yoksa teslim günlüğüne "kanal kapalı" düşer.

ÇIKIŞ KODU (fire/resolve): en az bir kanala iletildiyse 0, iletilmediyse 3. error-watch.sh "bildirildi mi"
kararını YALNIZ bu koddan verir; stdout'taki özet yalnız günlük içindir (stderr uyarıları onu bozamaz).
"""
import base64
import datetime as dt
import hashlib
import hmac
import ipaddress
import json
import os
import socket
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

DB = "supabase-db-moqbebljyeyprktd19zb1ihn"
ENV_FILE = "/root/emlaksoft/.env.production"
CACHE_DIR = "/run/emlaksoft"
CACHE = os.path.join(CACHE_DIR, "alert-channels.json")
FINGERPRINT = "health_down"
HKDF_SALT = b"emlaksoft:platform-secrets:salt:v1"
HKDF_INFO = b"emlaksoft/platform-secrets/v1"
DERIVE_SOURCES = ("OTP_HMAC_SECRET", "TWO_FACTOR_COOKIE_SECRET", "PROPERTY_MEDIA_SIGNING_SECRET")
EXIT_NOT_SENT = 3
DEFAULT_REPEAT_MIN = 30


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_env():
    env = {}
    try:
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


def parse_key(raw):
    v = (raw or "").strip()
    if not v:
        return None
    try:
        if len(v) == 64 and all(c in "0123456789abcdefABCDEF" for c in v):
            return bytes.fromhex(v)
        b = base64.b64decode(v.replace("-", "+").replace("_", "/") + "=" * (-len(v) % 4))
        return b if len(b) == 32 else None
    except Exception:
        return None


def candidate_keys(env):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    keys = []
    k = parse_key(env.get("PLATFORM_SECRETS_KEY"))
    if k:
        keys.append(k)
    for name in DERIVE_SOURCES:
        s = (env.get(name) or "").strip()
        if len(s) < 24:
            continue
        keys.append(HKDF(algorithm=hashes.SHA256(), length=32, salt=HKDF_SALT, info=HKDF_INFO).derive(s.encode()))
    return keys


def b64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def open_secret(storage_key, payload, keys):
    """platform-secrets.ts openPlatformSecret ile aynı: v1.<iv>.<tag>.<ct>, AAD platform_settings:<anahtar>."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if not payload:
        return None
    if not payload.startswith("v1."):
        return payload  # geçiş dönemi düz değer (yalnız eski platform ayarları)
    parts = payload.split(".")
    if len(parts) != 4:
        return None
    iv, tag, ct = b64u(parts[1]), b64u(parts[2]), b64u(parts[3])
    aad = ("platform_settings:" + storage_key).encode()
    for k in keys:
        try:
            return AESGCM(k).decrypt(iv, ct + tag, aad).decode()
        except Exception:
            continue
    return None


def psql(sql, variables=None, timeout=15):
    """SQL'i stdin'den verir; değerler psql değişkeni (:'ad') olarak geçer (tırnaklama psql'de)."""
    cmd = ["docker", "exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"]
    for k, v in (variables or {}).items():
        cmd += ["-v", f"{k}={v}"]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "psql hatası").strip()[:200])
    return r.stdout.strip()


def refresh():
    """Kanal (ŞİFRELİ) + kural + e-posta ayarlarını önbelleğe alır. Başarısızsa eski önbellek kalır."""
    out = psql(
        """
        select json_build_object(
          'channels', coalesce((select json_agg(json_build_object('id', id, 'kind', kind, 'name', name, 'sealed', config_sealed))
                                from public.alert_channels where enabled), '[]'::json),
          'rule', (select json_build_object('enabled', enabled, 'threshold', threshold, 'repeat_minutes', repeat_minutes,
                                            'muted_until', muted_until)
                   from public.alert_rules where key = 'health_down'),
          'email', (select json_object_agg(key, value) from public.platform_settings
                    where key in ('email.resend_api_key', 'email.from', 'email.reply_to')),
          'app_url', null
        )
        """
    )
    data = json.loads(out)
    os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)
    tmp = CACHE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    os.replace(tmp, CACHE)
    return data


def load_state():
    try:
        return refresh()
    except Exception:
        try:
            with open(CACHE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"channels": [], "rule": None, "email": {}}


def rule_info(state):
    r = state.get("rule") or {}
    enabled = r.get("enabled", True) is not False
    try:
        threshold = float(r.get("threshold")) if r.get("threshold") is not None else 2.0
    except (TypeError, ValueError):
        threshold = 2.0
    try:
        repeat = int(r.get("repeat_minutes")) if r.get("repeat_minutes") is not None else DEFAULT_REPEAT_MIN
    except (TypeError, ValueError):
        repeat = DEFAULT_REPEAT_MIN
    if repeat < 5 or repeat > 10_080:  # rules.ts mergeRuleConfigs ile aynı sınır
        repeat = DEFAULT_REPEAT_MIN
    muted = False
    mu = r.get("muted_until")
    if mu:
        try:
            muted = dt.datetime.fromisoformat(str(mu).replace("Z", "+00:00")) > dt.datetime.now(dt.timezone.utc)
        except ValueError:
            muted = False
    return enabled, threshold, muted, repeat


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Yönlendirme izlenmez (Node fetchExternal redirect: manual ile aynı): doğrulanmış adres 3xx ile iç ağa kaçamaz."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def is_blocked_host(hostname):
    """channel-config.ts isBlockedWebhookHost ile aynı ad/IP kuralları + DNS çözümü: herhangi bir adres
    özel/yerel/ayrılmış aralıktaysa reddedilir (kayıttan sonra DNS'i iç ağa çevrilen ad da geçemez)."""
    h = (hostname or "").lower().strip("[]")
    if not h or h == "localhost" or h.endswith((".localhost", ".local", ".internal")):
        return True
    try:
        ips = [ipaddress.ip_address(h)]
    except ValueError:
        if "." not in h:
            return True  # tek etiketli ad: docker/iç DNS adı olabilir
        try:
            ips = [ipaddress.ip_address(ai[4][0].split("%")[0]) for ai in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)]
        except (OSError, ValueError):
            return True
    if not ips:
        return True
    for ip in ips:
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            return True
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
                or ip.is_unspecified or ip in ipaddress.ip_network("100.64.0.0/10")):
            return True
    return False


def webhook_url_ok(url):
    try:
        u = urllib.parse.urlsplit(url)
        port = u.port
    except ValueError:
        return False
    if u.scheme != "https" or u.username or u.password or (port and port not in (443, 8443)):
        return False
    return not is_blocked_host(u.hostname or "")


def post_json(url, payload, headers=None, timeout=8):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with _OPENER.open(req, timeout=timeout) as res:
            return True, f"HTTP {res.status}"
    except urllib.error.HTTPError as e:
        if 300 <= e.code < 400:
            return False, f"HTTP {e.code} (yönlendirme izlenmez)"
        return False, f"HTTP {e.code}"
    except Exception as e:  # ağ/zaman aşımı
        return False, f"Bağlantı hatası ({type(e).__name__})"


def send(state, env, keys, subject, text, payload):
    deliveries = []
    at = now_iso()
    chans = state.get("channels") or []
    if not chans:
        return [{"at": at, "state": payload["event"], "channel": None, "kind": None, "ok": False, "detail": "kanal kapalı: etkin uyarı kanalı yok"}]
    for ch in chans:
        raw = open_secret("alert_channel:" + ch["id"], ch.get("sealed"), keys)
        try:
            cfg = json.loads(raw) if raw else None
        except ValueError:
            cfg = None
        d = {"at": at, "state": payload["event"], "channel": ch.get("name"), "kind": ch.get("kind")}
        if not cfg:
            deliveries.append({**d, "ok": False, "detail": "kanal kapalı: yapılandırma çözülemedi"})
            continue
        kind = ch.get("kind")
        if kind == "telegram":
            ok, info = post_json(
                f"https://api.telegram.org/bot{cfg['botToken']}/sendMessage",
                {"chat_id": cfg["chatId"], "text": text[:4000], "disable_web_page_preview": True},
            )
            deliveries.append({**d, "ok": ok, "detail": "Telegram iletildi" if ok else f"Telegram {info}"})
        elif kind == "webhook":
            if not webhook_url_ok(str(cfg.get("url") or "")):
                deliveries.append({**d, "ok": False, "detail": "Webhook reddedildi: iç ağ / geçersiz adres"})
                continue
            body = json.dumps(payload)
            headers = {"User-Agent": "emlaksoft-alerts/1.0"}
            if cfg.get("secret"):
                headers["X-EmlakSoft-Signature"] = "sha256=" + hmac.new(cfg["secret"].encode(), body.encode(), hashlib.sha256).hexdigest()
            ok, info = post_json(cfg["url"], payload, headers)
            deliveries.append({**d, "ok": ok, "detail": f"Webhook {info}"})
        elif kind == "email":
            em = state.get("email") or {}
            api_key = (env.get("RESEND_API_KEY") or "").strip() or open_secret("email.resend_api_key", em.get("email.resend_api_key"), keys)
            sender = (env.get("EMAIL_FROM") or "").strip() or (em.get("email.from") or "").strip()
            if not api_key or not sender:
                deliveries.append({**d, "ok": False, "detail": "kanal kapalı: Resend anahtarı veya gönderen tanımlı değil"})
                continue
            ok, info = post_json(
                "https://api.resend.com/emails",
                {"from": sender, "to": [cfg["to"]], "subject": subject[:200], "text": text},
                {"Authorization": f"Bearer {api_key}"},
            )
            deliveries.append({**d, "ok": ok, "detail": "E-posta iletildi" if ok else f"E-posta {info}"})
        else:
            deliveries.append({**d, "ok": False, "detail": "bilinmeyen kanal türü"})
    return deliveries


def record(event, title, body, deliveries, notified):
    """alert_events'e yazar (DB yoksa sessizce geçer; JSONL kaydı error-watch'ta zaten var)."""
    v = {"title": title[:200], "body": body[:2000], "deliv": json.dumps(deliveries), "notified": "1" if notified else "0", "fp": FINGERPRINT}
    try:
        if event == "firing":
            psql(
                """
                insert into public.alert_events (rule_key, fingerprint, severity, source, title, body, href, deliveries,
                                                 last_notified_at, notify_count)
                values ('health_down', :'fp', 'critical', 'host', :'title', :'body', '/admin/sistem?sekme=uyarilar', :'deliv'::jsonb,
                        case when :'notified' = '1' then now() end, case when :'notified' = '1' then 1 else 0 end)
                on conflict (fingerprint) where resolved_at is null
                do update set last_at = now(), title = excluded.title, body = excluded.body,
                  deliveries = (coalesce(public.alert_events.deliveries, '[]'::jsonb) || excluded.deliveries),
                  last_notified_at = coalesce(excluded.last_notified_at, public.alert_events.last_notified_at),
                  notify_count = public.alert_events.notify_count + excluded.notify_count;
                """,
                v,
            )
        else:
            psql(
                """
                update public.alert_events
                   set resolved_at = now(), last_at = now(),
                       resolved_notified_at = case when :'notified' = '1' then now() end,
                       deliveries = coalesce(deliveries, '[]'::jsonb) || :'deliv'::jsonb
                 where fingerprint = :'fp' and resolved_at is null;
                """,
                v,
            )
    except Exception as e:
        print(f"alert_events yazılamadı: {e}", file=sys.stderr)


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd = argv[0]
    if cmd == "refresh":
        try:
            refresh()
            return 0
        except Exception as e:
            print(f"önbellek tazelenemedi: {e}", file=sys.stderr)
            return 1
    state = load_state()
    enabled, threshold, muted, repeat = rule_info(state)
    if cmd == "rule":
        print(f"{1 if enabled else 0} {threshold:g} {1 if muted else 0} {repeat}")
        return 0
    if cmd not in ("fire", "resolve"):
        print(__doc__)
        return 2
    args = dict(zip(argv[1::2], argv[2::2]))
    title = args.get("--title", "Site yanıt vermiyor")
    body = args.get("--body", "")
    event = "firing" if cmd == "fire" else "resolved"
    reminder = event == "firing" and args.get("--reminder") == "1"
    env = read_env()
    app_url = (env.get("NEXT_PUBLIC_APP_URL") or "https://emlaksoft.com.tr").rstrip("/")
    prefix = "[SÜRÜYOR]" if reminder else ("[UYARI]" if event == "firing" else "[DÜZELDİ]")
    subject = f"{prefix} {title}"
    text = f"{subject}\n\n{body}\n\n{app_url}/admin/sistem?sekme=uyarilar".strip()
    payload = {"event": "reminder" if reminder else event, "rule": "health_down", "fingerprint": FINGERPRINT, "title": title, "body": body,
               "href": "/admin/sistem?sekme=uyarilar", "at": now_iso()}
    send_now = enabled and not muted
    if event == "resolved":
        send_now = send_now and args.get("--notified", "1") == "1"
    deliveries = send(state, env, candidate_keys(env), subject, text, payload) if send_now else [
        {"at": now_iso(), "state": event, "channel": None, "kind": None, "ok": False,
         "detail": "kural sessizde" if muted else ("kural kapalı" if not enabled else "uyarı gönderilmemişti")}
    ]
    record(event, title, body, deliveries, send_now)
    ok = any(d.get("ok") for d in deliveries)
    print(("gönderildi" if ok else "gönderilmedi") + ": " + "; ".join(str(d.get("detail")) for d in deliveries))
    return 0 if ok else EXIT_NOT_SENT


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
