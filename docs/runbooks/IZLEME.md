# İzleme ve alarm (runbook)

Amaç: canlı sitenin kapanması, cron'ların sessizce durması ve bekleyen ödeme mutabakatları kullanıcıdan önce fark edilsin.
Sahip: hesap kurulumunu platform sahibi yapar (UptimeRobot / Better Stack hesabı). Kod tarafı hazırdır.

## 1. Uç noktalar

| Uç | Auth | Ne söyler | Alarm koşulu |
| --- | --- | --- | --- |
| `GET /api/health` | yok | yalnız `{"ok":true\|false}` (DB + migration/sürüm hazır mı) | HTTP != 200 |
| `GET /api/health` + Bearer | `HEALTHCHECK_SECRET` | `status`, `db`, `ms`, `checks` (database, migrations, auth, storage, realtime), `release` | (elle inceleme) |
| `GET /api/health/cron` | `HEALTHCHECK_SECRET` Bearer, zorunlu | bayat / hatalı / hiç çalışmamış cron listesi | HTTP 503 |

`/api/health/cron` yanıtı: secret tanımsızsa 404, yanlış/yoksa 401 (ayrıntı verilmez). 200 `{ok:true}` veya 503 `{problems:[{job, reason: stale|error|never_ran, minutesSinceRun, staleAfterMinutes}]}`. Bayatlık penceresi her iş için `src/lib/cron-jobs.ts` `staleAfterMinutes` değeridir (aylık iş günlük bayat sayılmaz). Kural `/admin/sistem` Cron sağlığı kartıyla aynıdır.

Herkese açık yanıt yalnız `{ok}` taşır; DB durumu ve gecikme (`db`, `ms`) yalnız secret ile döner. Ayrıntılı modda auth (GoTrue),
storage ve realtime yoklanır (3 sn sınır): biri yanıt vermezse `services: "degraded"` ve ilgili `checks.<servis>.status = degraded`
raporlanır, ama `ok`/`status`/HTTP kodu DEĞİŞMEZ (genel durum yalnız DB + migration + sürüm kimliğine bağlıdır).

## 2. UptimeRobot / Better Stack kurulumu

1. `.env.production`'da `HEALTHCHECK_SECRET` (en az 32 karakter) tanımlı olmalı (`docs/DEPLOY.md`). Değeri monitör aracının gizli alanına koy, repoya yazma.
2. Monitör 1, **Site**: `https://emlaksoft.com.tr/api/health`, yöntem GET, aralık **5 dk**, beklenen durum 200. İstenirse anahtar kelime `"ok":true`.
3. Monitör 2, **Cron**: `https://emlaksoft.com.tr/api/health/cron`, GET, aralık **15 dk**, özel başlık `Authorization: Bearer <HEALTHCHECK_SECRET>`, beklenen durum 200 (503 = alarm).
4. Alarm alıcıları: platform sahibi e-postası + telefon/SMS (veya Better Stack çağrı). Yedek alıcı olarak ikinci bir kişi ekle. Ardışık **2 başarısız yoklama** sonrası bildir (geçici dalgalanmayı ele).
5. Durum sayfasını herkese açma; yalnız ekip içi.

## 3. Cron kaçırma

1. `/api/health/cron` 503 ise gövdedeki `problems` listesine bak; ya da `/admin/sistem` Cron sağlığı.
2. `reason: error` ise `/admin/sistem?sekme=hatalar` ve `/var/log/emlaksoft-cron.log`'da o işi (`/api/cron/<job>`) ara.
   `last_detail` `HTTP <kod> (çağrı)` ise rota hiç başarıyla yanıt vermemiştir; `zaman aşımı (çağrı, N sn)` ise 300 sn
   içinde yanıt gelmemiştir (rota Next içinde sürmüş olabilir). `scripts/sunucu/cron-call.sh` YALNIZ rota hiç çalışmadığında
   30 sn sonra bir kez yeniden dener: bağlantı kurulamadı/konteyner yok (kod 000, curl zaman aşımı değil) ya da 502/503/504.
   Zaman aşımı ve 500 dahil diğer kodlar yeniden DENENMEZ: rota kısmi ilerlemeden sonra düşmüş ya da hâlâ çalışıyor olabilir;
   idempotent olmayan işlerde (randevu-hatirlat, gorev-hatirlat, kira-tahakkuk, proje-vade, ef-kontor-* …) ikinci çağrı çift
   bildirim/tahakkuk üretir. Bu durumda bir sonraki zamanlanmış çağrı beklenir ya da önce yan etkiler kontrol edilip
   `/admin/sistem`'den elle tetiklenir. Başarısız sonuçta nabız `error` yazılır (rotanın kendi hata ayrıntısı arkasında korunur).
3. `reason: stale / never_ran`: `/etc/cron.d/emlaksoft` satırını gör (`scripts/sunucu/install-cron.sh`), gerekirse
   `/admin/sistem` üzerinden elle tetikle; `CRON_SECRET` ve konteyner durumunu doğrula.
4. Route'u olmayan nabız satırı: `npm run check:cron -- --db` canlı `cron_heartbeats`'i salt-okunur okur ve route'u
   (ya da `scripts/check-cron-contracts.ts` `NON_ROUTE_HEARTBEATS` kaydı) olmayan satırları listeler. Bu denetim silmez;
   eski satır (2026-10-14 itibarıyla `kampanya-gonder`, son nabız 2026-07-31) sahip onayıyla elle silinir.
5. Tek seferlik kaçırma yan etkileri için ilgili iş kılavuzuna bak (ör. `docs/runbooks/GEO_PROVINCE_SYNC.md`, `CORE_WORKFLOW_RECONCILIATION.md`).

## 4. Ödeme: günlük manual_review kontrolü

Her iş günü `/admin/billing` mutabakat kuyruğunda `manual_review` durumundaki tahsilat satırlarına bak (ayrıntı: `docs/runbooks/IYZICO_IADE.md` bölüm 3). Bekleyen satır varsa aynı gün içinde çöz; bir satır 24 saatten uzun beklememeli.

## 5. Sunucu hataları

Sunucu tarafı hatalar `/admin/sistem?sekme=hatalar` listesine `Sunucu` kaynağıyla düşer (`src/instrumentation.ts`, PII maskeli). Günlük bak; aynı hata sayacı artıyorsa öncelik ver.

Anlık akış: `scripts/sunucu/error-watch.sh` (systemd `emlaksoft-error-watch`) yeni/yeniden görülen her açık hatayı
`/var/log/emlaksoft/hatalar.jsonl`'a tek satır yazar. İmleç `hatalar.cursor` dosyasında `<last_seen µs>|<id>` çiftidir;
sorgu `(last_seen, id) > imleç` ile ilerler, böylece servis yeniden başlatıldığında aynı `id` için yinelenen satır
yazılmaz. BİLİNÇLİ TASARIM: hata yeniden görüldüğünde (`last_seen` ilerler, `occurrences` artar) aynı `id` için YENİ
satır yazılır — her satır bir görülme olayıdır, alıcı tarafı (uyarı/izleme) tekrar sıklığını bundan okur. "Yinelenen satır
yok" ölçütü yalnız yeniden BAŞLATMA/yeniden okuma yinelemesini kapsar; aynı `id`'nin farklı `last_seen` değerli satırları
yineleme değildir. Betik değişince `scripts/sunucu/install-error-watch.sh`.
Doğrulama: yeniden kurulumdan 10 dk sonra
`jq -r '"\(.id) \(.last_seen)"' /var/log/emlaksoft/hatalar.jsonl | tail -n 500 | sort | uniq -d` boş olmalı (aynı id +
aynı last_seen iki kez yazılmamalı); `jq -r .id … | sort | uniq -d` yalnız gerçekten yeniden görülen hataları vermeli.

İstemci kaynaklı istekler kayda girmez (`src/lib/server-error-report.ts`): bağlantı iptalleri ve okunamayan
`Next-Router-State-Tree` başlığı ("router state header ... could not be parsed"; 400 niteliğinde istemci hatası).

## 6. Sunucu kaynakları

`scripts/sunucu/host-metrics.sh` dakikada bir `host_metrics`'e yazar; `containers` alanı her zaman geçerli bir JSON
dizisidir (docker okunamazsa `[]`), satır bu yüzden düşmez. Elle deneme: `scripts/sunucu/host-metrics.sh --print`.

## 7. Geri dönüş

Tek satır: `bash scripts/sunucu/rollback.sh --dry-run && bash scripts/sunucu/rollback.sh` — ayrıntı ve şema uyumu:
`docs/runbooks/GERI_DONUS.md`.
