# SK1 — Supabase yığını ve sunucu ayarları (sahibin uygulayacağı adımlar)

Bu adımlar repo dışındadır (Coolify'daki Supabase servisi, `.env.production`, sunucu araçları). Kod tarafı
(`scripts/sunucu/{release,deploy}.sh`, `deploy/compose.prod.yml`, `/api/health`) bunlar olmadan da çalışır; her adım
ayrı ayrı uygulanabilir ve geri alınabilir. Ölçüm: önce ve sonra `bash scripts/sunucu/sk1-olcum.sh` (salt-okunur).

Taban (2026-10-15, Adım 0): Kong'da 24 saatte `GET /auth/v1/user` 8349, `POST /auth/v1/token` 74; PostgREST 24 saatte
82 "Schema cache loaded"; GoTrue users sorgusu 123.550 çağrı (pg_stat_statements 14 Ekim 18:46'dan beri);
`pg_stat_database.sessions` +48/dk; `supabase_auth_admin` boşta bağlantı 0.

Sıra: 1 (gündüz olabilir) → yayın A (kod) → 2-4 gece penceresinde, duyurularak → yayın B.

## 1. `SUPABASE_JWT_SECRET` (B019) — yalnız sunucu tarafı

Proxy erişim belirtecini bu sırla YEREL doğrular; sayfa/RSC/önyükleme başına `/auth/v1/user` turu 0 olur.

```bash
cd /root/emlaksoft
S=$(docker exec supabase-auth-moqbebljyeyprktd19zb1ihn printenv GOTRUE_JWT_SECRET)
grep -q '^SUPABASE_JWT_SECRET=' .env.production || printf 'SUPABASE_JWT_SECRET=%s\n' "$S" >> .env.production
unset S; chmod 600 .env.production
```

- `NEXT_PUBLIC_` ön eki ASLA verilmez (istemci paketine girer).
- Etkisi bir sonraki `deploy.sh` ile başlar. Doğrulama: `KONG_SINCE=10m bash scripts/sunucu/sk1-olcum.sh` →
  `GET /auth/v1/user` sayısı yalnız token yenileme kadar.
- Geri alma: satırı silip yeniden yayın. Sır tanımsızken yedek yol çalışır (getUser sonucu belirteç özetiyle ≤60 sn önbellek).

## 2. GoTrue bağlantı havuzu (B020) — gece, duyurulur

Coolify → Supabase servisi → `supabase-auth` ortamına ekleyin (dosya: `/data/coolify/services/moqbebljyeyprktd19zb1ihn/docker-compose.yml`,
`supabase-auth.environment`), sonra yalnız auth servisini yeniden başlatın:

```yaml
GOTRUE_DB_MAX_POOL_SIZE: '20'
GOTRUE_DB_MAX_IDLE_POOL_SIZE: '10'
GOTRUE_DB_CONN_MAX_IDLE_TIME: 10m
GOTRUE_DB_CONN_MAX_LIFETIME: 1h
```

Kabul: GoTrue `POST /token` p50 en az %40 düşer (bugün 178 ms); `pg_stat_database.sessions` artışı ≤20/dk;
`supabase_auth_admin` boşta bağlantı ≥5. Geri alma: dört satırı silip auth'u yeniden başlatmak.

## 3. PostgREST (B044) — gece, duyurulur

a) `supabase-rest.environment`: `PGRST_DB_POOL_MAX_IDLETIME: '3600'` (boşta bağlantılar saatte bir yenilenir; soğuk
   bağlantı ilk isteğe kalmaz). Yalnız rest servisi yeniden başlatılır.

b) DDL izleyicilerinin kapsamı: `20261016010100_pgrst_ddl_watch_scope.sql` migration'ı `postgres` rolüyle no-op olur
   (fonksiyonların sahibi `supabase_admin`). Gerçek uygulama:

```bash
bash scripts/sunucu/pgrst-watch-scope.sh            # uygular (tek işlem, idempotent)
bash scripts/sunucu/pgrst-watch-scope.sh --kontrol  # doğrular
bash scripts/sunucu/pgrst-watch-scope.sh --geri-al  # geri alır
```

`release.sh` artık migrate süresince `pgrst_ddl_watch` / `pgrst_drop_watch` event trigger'larını `supabase_admin`
ile kapatıp (EXIT tuzağıyla hata dahil her çıkışta) yeniden açar; tek `NOTIFY pgrst, 'reload schema'` deploy.sh'tadır.
Kabul: "Schema cache loaded" yayın başına ≤1, yayın dışında 24 saatte 0 (bugün 82).

## 4. Log yazımı / WAL (B015) — gece, duyurulur

Kong erişim logu `_supabase` DB'sine (Logflare `log_events_*`, en büyük tablo 1,6 GB) yazılıyor. Vector'da yalnız
4xx/5xx ve %5 örnek geçsin: `/data/coolify/services/moqbebljyeyprktd19zb1ihn/volumes/logs/vector.yml`

```yaml
transforms:
  # ... mevcut kong_logs'tan SONRA ekleyin:
  kong_sampled:
    type: sample
    inputs:
      - kong_logs
    rate: 20                     # 1/20 = %5 örnek
    exclude: '(to_int(.metadata.response.status_code) ?? 0) >= 400'   # 4xx/5xx her zaman geçer
sinks:
  logflare_kong:
    inputs:
      - kong_sampled             # eskiden: kong_logs
      - kong_err
```

Ardından `docker restart supabase-vector-moqbebljyeyprktd19zb1ihn`. Saklama süresi: Logflare kaynaklarının TTL'i
(`_supabase._analytics.sources.bigquery_table_ttl`, gün) Logflare arayüzünden ya da sürüm notlarına göre kısaltılır;
uygulamadan önce `_analytics` tablolarının yedeğini alın. Kabul: saatlik WAL ve `log_events` ekleme hızı tabana göre
≥%80 düşer (`sk1-olcum.sh`). Geri alma: `logflare_kong.inputs` yeniden `kong_logs`.

## 5. Yayın hattı (B043, B179, B181) — tek seferlik hazırlık

- Mavi/yeşil geçişin ilk yayını: mevcut `emlaksoft-app` mavi olarak kalır; ilk `deploy.sh` yeşili açar, geçişi yapar.
  Traefik `loadbalancer.healthcheck` /api/health'i 2 sn'de bir yoklar; boşaltma `/tmp/emlaksoft-drain` ile.
  Kontrol: `bash scripts/sunucu/sk1-olcum.sh --yayin-probu 300` ayrı terminalde koşarken `release.sh` → 5xx 0.
- Bekçinin canlı ölçümü için sunucuda Chromium: `npx playwright install chromium` (yoksa DCL "ölçülemedi" yazılır).
- Realtime olay gecikmesi için e2e-test iç kiracısının kullanıcısı: `.env.production`'a `RT_PROBE_EMAIL` ve
  `RT_PROBE_PASSWORD` (yoksa realtime ölçümü atlanır). Ölçüm o kiracıda 20 görev ekler ve hemen siler.
- Bekçi serisi `/srv/emlaksoft/bekci-seri` dosyasında; art arda 3 yeşilden sonra kırmızıda önceki sürüme kesintisiz döner.
  Yalnız uyarı: `WATCHDOG=warn`; kapatma: `WATCHDOG=off`.
- RLS kapısı (B182): `npm run db:rls-audit` gerçek migration'dan önce koşar ve ihlalde durur. 2026-10-15 itibarıyla
  denetim 26 bulgu veriyor (18 "politika yok", 8 "sarılmamış çağrı"); kurallar SK10'da güncellenene kadar yayın
  `RLS_GATE=warn bash scripts/sunucu/release.sh` ile bilinçli geçilir.
- Oturumlu E2E gece işi (`.github/workflows/nightly.yml` → `e2e-isolated`) GitHub runner'ında geçici Supabase açar;
  ilk üç gecenin sonucu kontrol edilir (kabul: son 3 gece yeşil).
