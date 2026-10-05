# İzleme ve alarm (runbook)

Amaç: canlı sitenin kapanması, cron'ların sessizce durması ve bekleyen ödeme mutabakatları kullanıcıdan önce fark edilsin.
Sahip: hesap kurulumunu platform sahibi yapar (UptimeRobot / Better Stack hesabı). Kod tarafı hazırdır.

## 1. Uç noktalar

| Uç | Auth | Ne söyler | Alarm koşulu |
| --- | --- | --- | --- |
| `GET /api/health` | yok (genel özet) | DB + migration/sürüm hazır mı | HTTP != 200 |
| `GET /api/health` + Bearer | `HEALTHCHECK_SECRET` | ayrıntılı kontrol | (elle inceleme) |
| `GET /api/health/cron` | `HEALTHCHECK_SECRET` Bearer, zorunlu | bayat / hatalı / hiç çalışmamış cron listesi | HTTP 503 |

`/api/health/cron` yanıtı: secret tanımsızsa 404, yanlış/yoksa 401 (ayrıntı verilmez). 200 `{ok:true}` veya 503 `{problems:[{job, reason: stale|error|never_ran, minutesSinceRun, staleAfterMinutes}]}`. Bayatlık penceresi her iş için `src/lib/cron-jobs.ts` `staleAfterMinutes` değeridir (aylık iş günlük bayat sayılmaz). Kural `/admin/sistem` Cron sağlığı kartıyla aynıdır.

## 2. UptimeRobot / Better Stack kurulumu

1. Vercel'de `HEALTHCHECK_SECRET` (en az 32 karakter) tanımlı olmalı (`docs/DEPLOY.md`). Değeri monitör aracının gizli alanına koy, repoya yazma.
2. Monitör 1, **Site**: `https://emlaksoft.vercel.app/api/health`, yöntem GET, aralık **5 dk**, beklenen durum 200. İstenirse anahtar kelime `"ready"`.
3. Monitör 2, **Cron**: `https://emlaksoft.vercel.app/api/health/cron`, GET, aralık **15 dk**, özel başlık `Authorization: Bearer <HEALTHCHECK_SECRET>`, beklenen durum 200 (503 = alarm).
4. Alarm alıcıları: platform sahibi e-postası + telefon/SMS (veya Better Stack çağrı). Yedek alıcı olarak ikinci bir kişi ekle. Ardışık **2 başarısız yoklama** sonrası bildir (geçici dalgalanmayı ele).
5. Durum sayfasını herkese açma; yalnız ekip içi.

## 3. Cron kaçırma

1. `/api/health/cron` 503 ise gövdedeki `problems` listesine bak; ya da `/admin/sistem` Cron sağlığı.
2. `reason: error` ise `/admin/hatalar` ve Vercel Logs'ta o işi (`/api/cron/<job>`) ara.
3. `reason: stale / never_ran`: Vercel > Cron Jobs ekranında işi gör, gerekirse "Run" ile elle tetikle; `CRON_SECRET` ve dağıtım durumunu doğrula.
4. Tek seferlik kaçırma yan etkileri için ilgili iş kılavuzuna bak (ör. `docs/runbooks/GEO_PROVINCE_SYNC.md`, `CORE_WORKFLOW_RECONCILIATION.md`).

## 4. Ödeme: günlük manual_review kontrolü

Her iş günü `/admin/billing` mutabakat kuyruğunda `manual_review` durumundaki tahsilat satırlarına bak (ayrıntı: `docs/runbooks/IYZICO_IADE.md` bölüm 3). Bekleyen satır varsa aynı gün içinde çöz; bir satır 24 saatten uzun beklememeli.

## 5. Sunucu hataları

Sunucu tarafı hatalar `/admin/hatalar` listesine `Sunucu` kaynağıyla düşer (`src/instrumentation.ts`, PII maskeli). Günlük bak; aynı hata sayacı artıyorsa öncelik ver.
