# Hetzner sunucusuna geçiş — devir belgesi (2026-10-13)

Bu belge, Windows dizüstündeki Claude oturumundan sunucudaki Claude oturumuna devir içindir. **Yeni oturum önce bunu, sonra `docs/HAFIZA.md` en üst notları okur.**

## Sahibin kararları (kesin)
- Vercel + Supabase (bulut) BIRAKILIYOR; her şey Hetzner sunucusunda çalışacak. Taşıma doğrulanıp bir süre sorunsuz çalıştıktan sonra Vercel ve Supabase projeleri **silinecek** (silmeden önce son tam yedek alınır).
- Deneme/staging adresi YOK: doğrudan ana alan adı **emlaksoft.com.tr** ile devam.
- Sahip her şeyin sorulmadan, profesyonelce yapılmasını istiyor; yalnız sahibin hesabıyla yapılabilecek adımlar tarif edilir.

## Sunucu
- Hetzner Cloud **CPX42** (8 vCPU AMD, 16 GB RAM, 320 GB disk), **Nuremberg** (eu-central), Ubuntu **24.04 LTS**, ad `emlaksoft-prod`.
- IPv4 **178.105.169.160**, IPv6 `2a01:4f8:1c1a:2daf::/64`.
- Yapılanlar: güncellemeler + `unattended-upgrades`, `fail2ban` (sshd), `ufw` (22, 80, 443, geçici 8000), 4 GB swap, SSH yalnız anahtar (`/etc/ssh/sshd_config.d/99-emlaksoft.conf`), Node 24, git, build-essential, Claude Code CLI.
- **Coolify v4** kurulu (`/data/coolify`), panel şimdilik `http://178.105.169.160:8000` (yönetici hesabını sahip açıyor). Coolify `.env` yedeği sahibin bilgisayarında: `C:\Users\volka\emlaksoft-sunucu-yedek\coolify-source.env`.
- Hetzner panelinde **Backups** henüz açılmamış olabilir — sahibe hatırlat.

## Depo ve ortam
- Kod: `/root/emlaksoft` (git `main`, origin `https://github.com/volkangezer46/emlaksoft.git`). Sunucunun GitHub'a push yetkisi henüz YOK: `ssh-keygen -t ed25519 -f ~/.ssh/github_deploy` üretip açık anahtarı sahibe "GitHub → repo → Settings → Deploy keys → Add (Allow write access)" olarak ekletin, sonra origin'i `git@github.com:volkangezer46/emlaksoft.git` yapın.
- `/root/emlaksoft/.env.local` (600): canlı Supabase bulut bağlantıları ve sırlar (taşıma kaynağı). `node_modules` kurulmadı → `npm ci`.
- Kontrol zinciri: `RM=<son migration> RC=<checksum> bash scripts/gate/full.sh` (RM/RC: `npm run check:migrations -- --release`). Sonuç `/tmp/emlaksoft-gate/full.log`. Sunucuda Coolify da çalıştığı için zinciri tek başına çalıştır.
- Claude hafızası `/root/.claude/projects/-root-emlaksoft/memory/` (19 not) ve önceki sohbet kaydı aynı klasörde (`d5682b9f-…jsonl`, `claude --resume` ile görülebilir; Windows yolları içerir).

## DNS (TurkTicaret, nameserver TurkTicaret'te)
- `emlaksoft.com.tr` A → 178.105.169.160 ✓, `www` A → 178.105.169.160 ✓.
- `*.emlaksoft.com.tr`: sahip CNAME'i IP'ye yazmıştı (geçersiz); A kaydı olarak düzeltmesi istendi. Doğrula: `dig +short panel.emlaksoft.com.tr`.
- Planlanan alt adresler: `panel.` (Coolify), `api.` (Supabase Kong), gerekirse `studio.` (Supabase Studio — yalnız IP/temel kimlik doğrulamasıyla).

## Hedef mimari
- Coolify (Traefik + Let's Encrypt) → uygulama Next.js 16 `output: "standalone"` Docker imajı (`emlaksoft.com.tr`, `www` → kalıcı yönlendirme).
- **Supabase self-hosted** (Coolify'daki Supabase servisi veya resmi `supabase/docker`): Postgres 17, GoTrue (auth), PostgREST, Realtime, Storage (yerel disk), Kong (`api.emlaksoft.com.tr`), Studio. Kod `@supabase/*` istemcileriyle değişmeden çalışır; yalnız URL/anahtar env'leri değişir.
- 36 cron (`vercel.json`) → sunucuda zamanlanmış çağrılar (Coolify Scheduled Tasks ya da systemd timer) `Authorization: Bearer $CRON_SECRET` ile; `npm run check:cron` sözleşmesi korunur.
- Yedek: her gece `pg_dump` + storage arşivi → Hetzner Storage Box (sahip açacak), WAL arşivi (pgBackRest/WAL-G) ile zaman noktasına dönüş; haftalık geri yükleme provası. Hetzner sunucu yedeği ek katman.
- E-posta (auth e-postaları): şu an Supabase bulut SMTP'si; self-hosted GoTrue için SMTP sağlayıcısı (ör. Brevo/Resend/SES) gerekir — sahibe sor/tarif et.

## İLERLEME (2026-10-13 gece, Windows oturumunun son hali)
- ✅ DNS (TurkTicaret wildcard kabul etmiyor → tek tek A): `emlaksoft.com.tr`, `www`, `panel`, `api` → 178.105.169.160.
- ✅ Hetzner Cloud Firewall `firewall-3`: yalnız TCP 22/80/443 (Docker portları ufw'yi atladığı için şart). 8000 dışarıdan kapalı doğrulandı.
- ✅ Coolify paneli **https://panel.emlaksoft.com.tr** (Let's Encrypt). Yönetici: volkangezer@yahoo.com. Panel FQDN tinker ile ayarlandı + `Server::find(0)->setupDynamicProxyConfiguration()`.
- ✅ Coolify API anahtarı (root yetki) sunucuda `/root/.coolify-token` (600). Örnek: `curl -H "Authorization: Bearer $(cat /root/.coolify-token)" http://localhost:8000/api/v1/servers`. Sunucu uuid `qvww13s3x5aqxomva7iok8px`, proje `EmlakSoft` uuid `gy91710lfyqoeg95mmhnreie`, ortam `production`.
- ✅ **Supabase servisi** Coolify uuid `moqbebljyeyprktd19zb1ihn`, Kong → **https://api.emlaksoft.com.tr** (auth/rest/storage 200 doğrulandı). Değişiklikler: Postgres imajı `supabase/postgres:17.6.1.178` (bulut 17.6 ile aynı; şablon 15.8 idi), MinIO kaldırıldı (`minio/mc` imajı Docker Hub'dan kalktı) → `STORAGE_BACKEND=file` (`./volumes/storage`), `STORAGE_PUBLIC_URL=https://api.emlaksoft.com.tr`. Düzenlenen compose: `/root/supabase-compose.yml` (orijinal `.orig.yml`), API ile `docker_compose_raw` (base64) PATCH. Env: API_EXTERNAL_URL=https://api.emlaksoft.com.tr, GOTRUE_SITE_URL=https://emlaksoft.com.tr, ADDITIONAL_REDIRECT_URLS, ENABLE_EMAIL_AUTOCONFIRM=true (SMTP yok), DISABLE_SIGNUP=false. Anon anahtar `/root/.sb-anon`; tüm anahtarlar Coolify servis env'lerinde (SERVICE_SUPABASEANON_KEY, SERVICE_SUPABASESERVICE_KEY, SERVICE_PASSWORD_POSTGRES, SERVICE_PASSWORD_JWT…). DB konteyneri `supabase-db-moqbebljyeyprktd19zb1ihn`.
- ✅ Bulut tam yedeği: `/root/backups/bulut-tam-20261012-2346.dump` (5 MB, pg_dump -Fc, 299 TABLE DATA; `supabase/postgres:17.6.1.178` imajıyla, DATABASE_POOLER_URL session modu 5432). Kopyası sahibin bilgisayarında `C:\Users\volka\emlaksoft-sunucu-yedek\`. DİKKAT: ssh tek tırnak içinde `tr -d "\x27"` kullanma — `\x27` harfiyen geçip URL'den 2 ve 7 rakamlarını siler; heredoc (`ssh host 'bash -s' <<'EOF'`) kullan. Doğrudan `db.<ref>.supabase.co` yalnız IPv6.
- Bulut DB: Postgres 17.6, 57 MB, eklentiler pg_stat_statements, pg_trgm, pgcrypto, supabase_vault, uuid-ossp.

### KONSEY TURU (2026-10-13 sabah) — durum
- EKLENTİ KARARI (sahip, 2026-10-13): 0.5.0 mağazaya GÖNDERİLMEYECEK; doğrudan "öğrenen" 0.6.0 gönderilecek (kurallar sunucudan veri olarak — uzak kod yok; form şeması + kullanıcı düzeltme sinyalleri; ofisler arası eşikle otomatik doğrulama; yönetimde "Portal kuralları" onay/sürüm/geri alma). Mağaza kimliği adijphobodnchdfcaekflbgdklofobco (0.4.0 liste dışı yayında).
- 2026-10-13 öğle: yetki onarımı (sahip uyguladı; anon'a açık fonksiyon 529→85, canlı yetkiler gölgeye göre hiçbir yerde daha geniş değil, 207 noktada daha sıkı = bulut hâli) + 3 migration (374/374) + RELEASE_MIGRATION 20261013000400. PostgREST havuzu 20. Gezertaşar aboneliği 2027-10-13'e uzatıldı. EmlakFiyati anahtarı yönetim formuyla yeni PLATFORM_SECRETS_KEY ile yeniden kaydedildi. `age` kurulu (BACKUP_AGE_RECIPIENT bekliyor). Eklenti 0.5.0 yalnız emlaksoft.com.tr (release/…-0.5.0.zip; mağazaya sahip yükler). Hata akışına dakikalık dış sağlık kontrolü (KESİNTİ/DÜZELDİ). Yayınlar arası statik parçalar /srv/emlaksoft/next-static'te korunur.
- Yönetim paneli turu: tasarım konseyi wf_479ae75c-104 (21 onay/17 erteleme/1 ret), 8 paket (AP1-AP8) uygulanıyor (wf_3b6ba63f-ff5); paket tanımları /root/emlaksoft-paketler.json. AP1'de SAHİP KARARI: demo kartları açık kalır.
- 13 uzmanlı konsey: 74 öneri (54 onay / 15 erteleme / 5 ret); karar dökümü workflow wf_60ebcf62-6a0 (journal.jsonl).
- 7 iş paketi uygulandı + bağımsız gözden geçirildi + birleştirildi + CANLIDA (emlaksoft-app:202610130450-fce6c10b). Canlı duman: ofis sahibi masaüstü 38 sayfa, danışman mobil 22 sayfa — 0 sorun.
- Postgres ayarı CANLIDA (shared_buffers 3GB, effective_cache_size 8GB, work_mem 16MB, jit off, random_page_cost 1.1…; yedek /root/backups/postgresql.auto.conf.before-tuning).
- Demo kartları (ofis + personel/süper admin) SAHİP KARARIYLA AÇIK (2026-10-13: "ben diyene kadar kaldırma"); PRODUCTION_PLATFORM_DEMO_OPT_IN=true. Gerçek müşteriye açılmadan kapatılmalı.
- ⚠️ SAHİP ADIMI BEKLİYOR 1 — FONKSİYON/TABLO YETKİ ONARIMI (KRİTİK): taşımada varsayılan yetkiler yüzünden 529 public fonksiyon anon'a açık. Onarım: `docker exec -i supabase-db-moqbebljyeyprktd19zb1ihn psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < /root/backups/acl-onarim.sql` (bulut yedeğindeki 758 nesnenin yetkisi birebir; tek transaction; anlık görüntü acl-before-*.tsv). Doğrulama: `npm run check:acl -- --container supabase-db-moqbebljyeyprktd19zb1ihn --shadow <bash scripts/db-shadow-replay.sh çıktısı>`.
- ⚠️ SAHİP ADIMI BEKLİYOR 2 — 3 MIGRATION: `cd /root/emlaksoft && npm run db:migrate` (20261013000200 RLS InitPlan, 000300 indeks, 000400 yoklamalar; yedek db-20261013-0457.dump, dry-run temiz). Sonra .env.production RELEASE_MIGRATION=20261013000400_ready_probes_pg_catalog.sql / RELEASE_MIGRATION_CHECKSUM=dbcf8028909203cc + scripts/sunucu/deploy.sh.
- Bekleyen altyapı (konsey onaylı, orkestratör): PostgREST havuzu 20 (compose hazır: /root/supabase-compose.yml), GoTrue DB havuzu, açık kayıt kapatma kararı (/kayit akışı denetlenmeli), yönetim yüzeylerini dışa kapatma, age şifreli + sunucu dışı yedek (Storage Box/age anahtarı sahipte), WAL-G PITR.
- Ertelenenler: ES256/JWKS, iç ağ Supabase URL'si, Broadcast realtime, blue/green, replika/Redis, 129 FK indeksi, büyük özellikler (ARS1-2/4/5/6/7).

### İLERLEME (2026-10-13 sabah) — CANLI: https://emlaksoft.com.tr
- ⚠️ OLAY (2026-10-13 01:30-01:39 UTC): girişler 500 "refresh_tokens_pkey duplicate" — geri yüklemede auth sayaçları taşınmamıştı (`auth.refresh_tokens_id_seq` 44, tablo azamisi 1372). `setval` ile düzeltildi; `restore-list.py` artık auth/storage SEQUENCE SET'i alır, `restore-cloud-dump.sh` sonunda tüm sahipli sayaçları sütun azamisine taşır. Kesme anında yeniden yüklemede otomatik.
- Demo girişi her tıklamada parolayı yeniden yazıyordu → GoTrue o hesabın DİĞER oturumlarını siliyordu (aynı kartla giren ikinci kişi/sekme ilkini atıyordu). Düzeltme: parola yalnız giriş "invalid_credentials" ile başarısız olursa bir kez yazılır; meta veri yalnız bozuksa parolasız onarılır (src/app/actions/demo-login.ts).
- ✅ Supabase imajları yükseltildi (`/root/supabase-compose.yml` = önceki `.next.yml`; eski hali `/root/backups/supabase-compose.pre-upgrade.yml`).
- ✅ Bulut verisi canlı DB'ye yüklendi (`bulut-tam-20261013-0004.dump`): 287 tablo / 41.453 satır birebir, `check:migrations --database` + `db:rls-audit` temiz. Geri yüklemeden sonra **`NOTIFY pgrst, 'reload schema'` şart** (yoksa PGRST205 / health 503).
- ✅ Uygulama: `scripts/sunucu/deploy.sh` (Dockerfile + BuildKit secret, `deploy/compose.prod.yml`, konteyner `emlaksoft-app`, Coolify Traefik etiketleri, Let's Encrypt `emlaksoft.com.tr` + `www` → kök 301, HSTS, h3). Coolify uygulaması DEĞİL; Coolify panelinde görünmez.
- ✅ Tek env kaynağı `/root/emlaksoft/.env.production` (600; yedek `/root/backups/env.production.*`). Sırlar YENİDEN ÜRETİLDİ (Vercel'deki değil): DB'de Vercel anahtarına bağlı şifreli veri yoktu (advisor_private enc 0, fsbo 0; EmlakFiyati anahtarı env yedeğiyle çalışır — admin'den yeniden girilmeli). ADVISOR_PII_KEY/PLATFORM_SECRETS_KEY artık KAYBEDİLMEMELİ.
- ✅ 36 cron: `/etc/cron.d/emlaksoft` (`scripts/sunucu/install-cron.sh`, vercel.json'dan üretilir; günlük `/var/log/emlaksoft-cron.log`).
- ✅ `.env.local` artık self-hosted Supabase'i gösterir (bulut hali `/root/backups/env.local.bulut-*`). DATABASE_URL Docker iç IP'si (`sslmode=disable`).
- EKSİK (sahip): entegrasyon anahtarları (OpenAI, iyzico canlı, Netgsm, Resend/EMAIL_FROM, VAPID, WhatsApp/Meta, EVDS, Google OAuth) → `.env.production`'a ekle + `deploy.sh`; GoTrue SMTP (şimdilik ENABLE_EMAIL_AUTOCONFIRM=true, parola sıfırlama e-postası GİTMEZ); GitHub deploy key; Hetzner Backups + Storage Box; gece yedeği; Vercel/Supabase bulut hâlâ çalışıyor (emlaksoft.vercel.app eski veriyle yazmaya devam ediyor — kesme kararı).

### İLERLEME (2026-10-13, sunucu oturumu)
- ⚠️ `bulut-tam-20261012-2346.dump` **GRANT içermiyor** (0 ACL) → geri yükleme için kullanma. Yeni yedek **`/root/backups/bulut-tam-20261012-2356.dump`** (1018 ACL, DATABASE_POOLER_URL 5432 ile).
- ⚠️ Sürüm farkı: bulut GoTrue son göç `20260831180000` (= **v2.197.0**), Storage göç 72; Coolify şablonu v2.186.0 / v1.44.2 (göç 56). Veri bu eski şemalara yüklenmez. Hazır compose: **`/root/supabase-compose.next.yml`** (gotrue v2.197.0, storage-api v1.80.2 [göç 73], realtime v2.134.10, postgrest v14.17, postgres-meta v0.99.0, edge-runtime v1.76.2; supavisor/studio/kong aynı — env adları farklı). **Canlı servise uygulanması otomatik denetimce engellendi → sahip onayı gerekli** (komut aşağıda).
- ✅ Prova geri yükleme (izole konteyner, aynı imajlar): `scripts/sunucu/restore-cloud-dump.sh` + `restore-list.py` — public şeması (yetkiler dahil) + pg_trgm + `ensure_rls` + avatar politikaları + auth/storage verisi (göç tabloları hariç), `session_replication_role=replica`. Sonuç: 287 tablo / **41.448 satır birebir**, 254 tablo/535 politika/220 tetikleyici, realtime yayını 19 tablo, `check:migrations --database` temiz (371 · `5d126cdcf3825980`), `db:rls-audit` yalnız beklenen 5 "politika yok" (service_role tabloları), GoTrue v2.197.0 kullanıcıları okuyor (12 kullanıcı). Beklenen 2 pg_restore hatası `ensure_rls` (betik postgres rolüyle yeniden kurar).
- ✅ Storage: bulutta 7 kova, **0 nesne** (API ile de doğrulandı) → kopyalanacak dosya yok; kovalar DB verisiyle gelir. Kesme anında yeniden kontrol et.
- `scripts/rls-audit.ts` / `validate-migrations.ts`: URL'de `sslmode=disable` varsa SSL'siz bağlanır (self-hosted Postgres SSL'siz).
- Not: JWT sırrı farklı → taşımadan sonra herkes yeniden giriş yapar (parola özetleri taşınır).

Sahip onayıyla uygulanacak (canlı Supabase servisi; şu an içinde veri yok):
```bash
B64=$(base64 -w0 /root/supabase-compose.next.yml)
curl -s -X PATCH -H "Authorization: Bearer $(cat /root/.coolify-token)" -H 'Content-Type: application/json' \
  http://localhost:8000/api/v1/services/moqbebljyeyprktd19zb1ihn -d "{\"docker_compose_raw\":\"$B64\"}"
curl -s -X POST -H "Authorization: Bearer $(cat /root/.coolify-token)" \
  "http://localhost:8000/api/v1/services/moqbebljyeyprktd19zb1ihn/restart?latest=true"
# göçler bitince: max(auth.schema_migrations)=20260831180000, max(storage.migrations.id)>=72
# sonra: scripts/sunucu/restore-cloud-dump.sh <yedek> <servis docker ağı> supabase-db <SERVICE_PASSWORD_POSTGRES>
```

### Sıradaki somut adımlar
1. ~~Yedek doğrula~~ (prova tamam, yukarı bak) → canlı servise compose yükseltmesi + gerçek geri yükleme (sahip onayı); ayrıca Supabase yöntemine göre ayrı dosyalar: roller (`pg_dumpall --roles-only` yerine bulutta yalnız özel roller), şema (public + özel şemalar), veri (`auth`, `storage`, `public` data-only). Yeni DB'ye: önce şema, sonra `SET session_replication_role = replica;` ile veri. `auth`/`storage` şemaları self-hosted'ta zaten var → yalnız veri.
2. Storage nesneleri: bulut Storage API (service key) ile tüm kovaları indir → yeni Storage'a yükle (aynı bucket/yol; `storage.objects` satırları veriyle gelir, dosya baytları ayrıca kopyalanmalı).
3. `npm run check:migrations -- --database` (yeni DB URL ile) + `npm run db:rls-audit`.
4. Uygulama: Coolify'da "Public/Private Git Repository" (deploy key) ya da Dockerfile ile Next.js standalone; env'ler Vercel üretim değişkenlerinden (sahip `vercel env pull` / panelden) + yeni Supabase URL/anahtarlar; domain `https://emlaksoft.com.tr`, `www` yönlendirme.
5. 36 cron → Coolify Scheduled Tasks (Bearer CRON_SECRET), iyzico/e-fatura webhook adresleri, Google OAuth redirect, eklenti EmlakSoft alanı (yeni sürüm).
6. Kesme: bulutta yazmayı durdur → son fark → açılış → izleme → 1-2 hafta sonra Vercel/Supabase silme (önce son yedek).

## Taşıma adımları (sırayla)
1. ✅ Sunucu sertleştirme, Coolify, Node, Claude Code, depo + .env.local + hafıza aktarımı.
2. Sahip: Coolify yönetici hesabı; DNS `*` A kaydı; Hetzner Backups; GitHub deploy key; SMTP sağlayıcısı.
3. Supabase self-hosted kur (`api.emlaksoft.com.tr`), JWT sırları/anon/service anahtarlarını üret, sırları güvenli sakla.
4. Bulut Supabase'den **tam yedek**: `pg_dump` (şema + veri, `auth`, `storage` şemaları dahil; rol/sahiplik farklarına dikkat), Storage nesnelerinin tamamı (kovalar listesi: customer-files, property-media, agent-photos, tenant-logos, expense-receipts, rent-receipts…). Bir kopyası sunucuda, bir kopyası Storage Box'ta.
5. Yeni Postgres'e geri yükle; `npm run check:migrations -- --database` ile ledger/checksum doğrula; RLS denetimi `npm run db:rls-audit`.
6. Uygulama env'lerini (Vercel'deki tüm üretim değişkenleri — sahibin Vercel panelinden ya da `vercel env pull`) Coolify'a taşı; Supabase URL/anahtarlarını yenileriyle değiştir; `NEXT_PUBLIC_APP_URL=https://emlaksoft.com.tr`.
7. Cron'ları kur, iyzico/Nilvera/EVDS/OpenAI dönüş adreslerini (callback/webhook) yeni alan adına çevir; Google OAuth/Supabase redirect allowlist; Chrome eklentisi `NEXT_PUBLIC_*` ve manifest EmlakSoft alanı (`emlaksoft.vercel.app` → `emlaksoft.com.tr`, yeni eklenti sürümü gerekir).
8. Bakım penceresi: bulut tarafında yazmayı durdur → son fark yedeği → geri yükle → DNS zaten sunucuda → smoke (`npm run smoke:live` BASE ile) → açılış.
9. 1-2 hafta izleme; sonra son yedek ve Vercel/Supabase silme.

## Yayın, bellek, yedek ve sayaç denetimi (işletme notları)

**Yayın ve geri dönüş (`scripts/sunucu/deploy.sh`):** derlemeden ÖNCE yayındaki imaj `PREV` olarak alınır
(`docker inspect emlaksoft-app --format '{{.Config.Image}}'`; `latest` ise kimliği `emlaksoft-app:onceki` etiketine bağlanır).
Yeni sürüm ayağa kalkınca sağlık önce konteyner içinden (`127.0.0.1:3000/api/health`, Traefik'ten bağımsız), sonra dış
`https://emlaksoft.com.tr/api/health` ile beklenir (toplam 120 sn). Başarısızsa `APP_TAG=${PREV#emlaksoft-app:}` ile önceki imaj
yeniden ayağa kaldırılır, sağlığı yeniden beklenir, sonuç yazılır ve betik **exit 1** ile biter (yeni sürüm yayında kalmaz).
Derlemeden sonra `check-bundle-budget.ts --gate` yalnız uyarı verir; ardından `npm run --if-present check:acl -- --warn`
çalışır — yalnız `ACL_GATE=strict` iken başarısızlık yayını durdurur. RELEASE_MIGRATION kuralı aynı (yukarıda).

**Bellek sınırı (`deploy/compose.prod.yml`):** `mem_limit: 2g`, `memswap_limit: 2g` (takas yok), `NODE_OPTIONS=--max-old-space-size=1536`
(V8 yığını sınırın altında kalır; kalan ~500 MB yerel bellek/arabellek), `stop_grace_period: 20s`. Konteyner adı, Traefik etiketleri
aynı; blue/green YOK (yayın anında birkaç saniyelik kesinti olabilir). Dockerfile HEALTHCHECK `--start-interval=2s` (Docker ≥25):
açılışta sağlık 2 sn arayla denenir, `healthy` durumu daha erken gelir.

**Yedek şifreleme (`scripts/sunucu/backup-db.sh`):**
- `BACKUP_AGE_RECIPIENT=age1...` (yalnız AÇIK anahtar; gizli anahtar sunucuda TUTULMAZ, sahibin bilgisayarında/kasada) tanımlıysa
  `db-*.dump.age` ve `storage-*.tgz.age` yazılır; düz döküm bütünlük denetiminden sonra silinir, düz dosya bırakılmaz. İzinler 600.
- `age` kurulu değilse (`apt install age`) ya da değişken tanımsızsa betik açık UYARI yazar ve eski moda (şifresiz) düşer.
- `BACKUP_REMOTE` varsa yalnız o geceki çıktı dosyaları (şifreliyse `.age`) rsync ile taşınır.
- Storage denetimi: `storage.objects` satır sayısı ile tar içindeki dosya sayısı karşılaştırılır; fark varsa uyarı loglanır.
- Geri açma: `age -d -i anahtar.txt db-....dump.age > db.dump` → `pg_restore`.

**Sayaç kayması (`scripts/sunucu/check-sequences.sql`):** public/auth/storage şemalarında sütuna bağlı her sayaç için sıradaki
değer sütun azamisini geçmiyorsa NOTICE ile raporlar (2026-10-13 `refresh_tokens_pkey` olayı). Varsayılan salt-okunur;
düzeltme isteğe bağlı ve idempotent:
```bash
docker exec -i supabase-db-moqbebljyeyprktd19zb1ihn psql -U postgres -d postgres < scripts/sunucu/check-sequences.sql            # rapor
docker exec -i supabase-db-moqbebljyeyprktd19zb1ihn psql -U postgres -d postgres -v fix=1 < scripts/sunucu/check-sequences.sql   # rapor + setval
```
`restore-cloud-dump.sh` geri yüklemenin sonunda bu dosyayı (rapor modunda) ve `npm run --if-present check:acl` denetimini çağırır.
ACL notu: dökümdeki "anon'dan geri alınmış" yetkiler hedefte pg_default_acl yüzünden geri gelebilir (`restore-list.py` başındaki
açıklama) → geri yüklemeden sonra ACL farkı `check:acl` ile kontrol edilir.

**Destek ve yasal kimlik (AD12):** ADMİNDEN girilir — /admin/ayarlar/yasal?sekme=sirket (ayar defteri `legal.entity_*`
ünvan/adres/MERSİS/vergi dairesi/vergi no/KEP/telefon ve `support.email|phone|whatsapp`); mesafeli satış, ön bilgilendirme,
fatura başlığı ve yasal sayfalar ≤30 sn'de yansır, deploy gerekmez. Env yalnız YEDEK: `LEGAL_UNVAN`, `LEGAL_ADRES`,
`LEGAL_MERSIS`, `LEGAL_VERGI_DAIRESI`, `LEGAL_VERGI_NO` (eski birleşik `LEGAL_VERGI`), `LEGAL_KEP`, `LEGAL_TELEFON`,
`SUPPORT_EMAIL`/`SUPPORT_PHONE`/`SUPPORT_WHATSAPP` (eski `NEXT_PUBLIC_SUPPORT_*` son yedek). Boş alan gösterilmez; bilgi uydurulmaz.
Yasal sayfa metinleri sürümlü (/admin/ayarlar/yasal, `legal_documents`); yardım merkezi /admin/site/yardim (`help_articles`).

## Bekleyen ürün işleri (taşıma sonrası)
- Durdurulan "ana beyin" iş akışı (hata avcıları + internet araştırması + karar + uygulama) taşımadan sonra yeniden çalıştırılacak.
- Sahipten beklenenler: destek e-postasının gerçek adresi (`.app` mı `.com.tr` mi), Chrome eklenti kimliği (0.4.0 incelemede, 0.5.0 hazır), EVDS anahtarı, Nilvera test faturası, portal ortaklık başvuruları.

- **2026-10-13 12:05** — Eklenti 0.6.0 canlı altyapı tamam: P1–P4 deploy (7d57844d), imzalı tohum v1 yayınlandı (sahibinden/hepsiemlak/emlakjet, kid k1), E2E/admin/Demo kiracıları öğrenmeden dışlandı, `auto_publish` kapalı. Mağaza paketi `/root/eklenti-0.6.0/emlaksoft-ilan-kontrol-0.6.0.zip` (sha256 bf50f75e…, canlı indirme ile birebir). Gizlilik/çerez/KVKK metinleri: çerezsiz anonim ziyaret ölçümü, kayıt kaynağı (meşru menfaat), barındırma Almanya (Nürnberg); ana sayfa "Frankfurt" ifadeleri düzeltildi. Sıradaki: SEO/Reklam/Hız SP1–SP4 birleştir → gate → deploy; SP migration'ları sahip `npm run db:migrate`.
