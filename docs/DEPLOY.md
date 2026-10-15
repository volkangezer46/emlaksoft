# EmlakSoft — Deploy Rehberi (tek kaynak)

**2026-10-13'ten beri üretim Hetzner sunucusunda** (https://emlaksoft.com.tr): self-hosted Supabase (Coolify servisi,
`https://api.emlaksoft.com.tr`) + uygulama Docker imajı. Yayın TEK komut: `bash scripts/sunucu/release.sh` (aşağıda §0).
Aşağıdaki "Vercel ortam değişkenleri" tablosu artık `/root/emlaksoft/.env.production` için geçerlidir (değişiklikten sonra
`deploy.sh`). Cron: `scripts/sunucu/install-cron.sh`; gece yedeği `scripts/sunucu/backup-db.sh`.
Ayrıntı ve açık işler: `docs/SUNUCU_DEVIR.md`. Aşağıdaki Vercel ifadeleri yedek ortam içindir.

## 0. Hetzner yayın akışı (`scripts/sunucu/release.sh`)

Sıra; her adım düşerse yayın DURUR (sonraki adımlar koşmaz, çıkış kodu sıfırdan farklı):

1. **Kirli çalışma ağacı:** `git status --porcelain` boş değilse (`.claude/` altındaki izlenmeyenler hariç) yayın başlamaz.
   Yayınlanan imaj commit'lenmemiş kod taşımaz; bilinçli geçiş `ALLOW_DIRTY=1` (günlüğe yazılır).
2. **Hızlı kapı:** `scripts/gate/fast.sh` (tsc + lint + tam vitest, ardından check:links/cron/migrations, audit:actions).
   `SKIP_GATE=1` yalnız acil düzeltmede.
3. **Migration provası:** `npm run db:rehearse -- --pending` bekleyen dosyaları GERÇEK şemada tek transaction'da çalıştırıp her
   koşulda geri alır; bozuk dosya gerçek migration'dan ÖNCE yakalanır (`/tmp/emlaksoft-gate/rehearse.log`). Bilinçli geçiş
   `REHEARSE_GATE=warn`.
4. **RLS kapısı:** `npm run db:rls-audit` gerçek migration'dan ÖNCE koşar; ihlalde durur (`/tmp/emlaksoft-gate/rls-audit.log`).
   Bilinçli geçiş (ör. yayının kendi getirdiği kurallar henüz uygulanmadıysa) `RLS_GATE=warn`.
5. **Migration:** `npm run db:migrate` (PostgREST DDL izleyicileri kapalı; EXIT tuzağı her çıkışta yeniden açar). Hata olursa
   çıkış kodu KORUNUR ve yayın durur: sürüm işareti yazılmaz, deploy ve push yapılmaz (tam çıktı `/tmp/emlaksoft-gate/migrate.log`).
6. **Ledger + sürüm işareti:** `check:migrations -- --database --release` diskteki TÜM dosyalar ledger'da değilse durur;
   `.env.production` `RELEASE_MIGRATION(_CHECKSUM/_COUNT)` güncellenir.
7. **Deploy (`scripts/sunucu/deploy.sh`):** Docker imajı (BuildKit secret), statik parçalar kalıcı klasörde birleşir, paket bütçesi
   (`BUNDLE_GATE=warn`), ACL denetimi (`ACL_GATE=strict`), tek "reload schema" + RPC ısıtma, ardından **mavi/yeşil kesintisiz
   geçiş** (`scripts/sunucu/bluegreen.sh`): yeşil yeni imajla açılır → sağlıklı → mavi boşaltılıp yeni imajla kurulur → yeşil
   kaldırılır. Yeşil sağlıklı olmazsa eski sürüm hiç kapanmadan yayında kalır. Traefik etiketleri değişen yayında (ör. yeni yük
   dengeleyici ayarı) tek seferlik yeniden kurma yapılır (kısa kesinti). Yayından sonra **bekçi** (public smoke + measure-live);
   art arda 3 yeşilden sonra kırmızıda önceki sürüme kesintisiz döner. Sonuç `public.release_history`'ye yazılır.
8. **`git push`** (yalnız deploy başarılıysa).

Elle geri dönüş: `bash scripts/sunucu/rollback.sh [--dry-run] [etiket]` — deploy ile AYNI mavi/yeşil geçişi kullanır (kesintisiz);
hedef sağlıklı olmazsa yayındaki sürüm yerinde kalır. DB geri alınmaz (forward-only). Ayrıntı `docs/runbooks/GERI_DONUS.md`.

Vercel + Supabase üretim hattı (YEDEK). Bu belge eski iki checklist'i birleştirir
(`docs/arsiv/DEPLOY_CHECKLIST_kok.md`, `docs/arsiv/DEPLOY_CHECKLIST_docs.md`). Rota/migration sayıları burada
sabitlenmez; güncel sayılar `docs/DURUM.md`. Olay/rollback/restore: `docs/runbooks/`.

## Sıra (değişmez): önce veritabanı, sonra kod

1. Kapıları koş (§1).
2. Yedek/PITR doğrula (§3), sonra veritabanını migrate et (`npm run db:migrate`).
3. Release migration kimliğini üret, Vercel env'ine yaz (§2).
4. Kodu deploy et (Vercel).
5. Deploy sonrası doğrula (§4) ve gözle (§5).

Neden DB önce: kod yeni şemaya bağlı olabilir; migration'lar forward-only ve geriye uyumlu tasarlanır, bu yüzden
eski kod yeni şemada çalışır, tersi geçerli değildir.

## 1. Değişiklik ve güvenlik kapıları

- [ ] Çalışma ağacında beklenmeyen dosya yok; `npm ci` temiz.
- [ ] `npm run check:links` · `check:migrations` · `check:cron` · `audit:actions` · `audit:deps`
- [ ] `npm run type-check` · `npx eslint . --max-warnings=0` · `npm test`
- [ ] `npm run test:e2e:public` · `npm run build`
- [ ] CI tam geçmişte gitleaks taramasını geçti.

## 2. Vercel ortam değişkenleri (Production scope)

Zorunlu (eksikse `next build`/`next start` production'da başlamaz veya readiness 503 döner):

| Değişken | Not |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Secret yalnız sunucu; legacy anon/service_role kapalı |
| `NEXT_PUBLIC_APP_URL` | Gerçek HTTPS origin |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | ARTIK GEREKMEZ (AD12). Destek e-postası/telefon/WhatsApp ve şirket kimliği adminden girilir: /admin/ayarlar/yasal?sekme=sirket (ayar defteri `support.*`, `legal.entity_*`; deploy gerekmez). Tanımlıysa yalnız eski kurulum yedeği olarak okunur; sunucu yedeği `SUPPORT_EMAIL` / `SUPPORT_PHONE` / `SUPPORT_WHATSAPP` |
| `OTP_HMAC_SECRET` | Bağımsız, >=32 byte; diğer sırlarla paylaşılmaz. Değişirse aktif OTP'ler için 5 dk pencere planla |
| `TWO_FACTOR_COOKIE_SECRET` | Bağımsız, >=32 karakter |
| `PROPERTY_MEDIA_SIGNING_SECRET` | Bağımsız, >=32 karakter |
| `HEALTHCHECK_SECRET` | >=32 karakter; yetkili `/api/health` ayrıntısı için |
| `CRON_SECRET` | Güçlü, bağımsız; tüm cron route'ları Bearer doğrular |
| `RELEASE_MIGRATION`, `RELEASE_MIGRATION_CHECKSUM` | **Yeni migration sonrası güncellenir** (aşağıda) |
| `PLATFORM_ADMIN_EMAILS` | En az iki kontrollü yönetici önerilir |
| `PLATFORM_SECRETS_KEY` | **Zorunlu** (admin'den girilen üçüncü taraf API anahtarlarını `platform_settings` içinde AES-256-GCM ile şifreler). Üretim: `openssl rand -hex 32` (64 hex). Yoksa Admin > Sistem > EmlakFiyati formu "etkin değil: PLATFORM_SECRETS_KEY tanımlı değil" der ve KAYDETMEZ. **Kaybedilir/değişirse** şifreli kayıtlar çözülemez: admin'deki anahtar yeniden girilmelidir (ortam yedeği varsa o devreye girer). `NEXT_PUBLIC_` DEĞİL, diğer sırlarla paylaşılmaz |
| `FSBO_PHONE_HMAC_KEY` | Önerilen (Sahibinden ilanlar / portföy avı): aranmasın listesi ve telefon özeti için HMAC-SHA256 sunucu anahtarı (v2; en az 32 karakter, `openssl rand -hex 32`). Yoksa canlıda zaten zorunlu `OTP_HMAC_SECRET` (yoksa `TWO_FACTOR_COOKIE_SECRET`, `PROPERTY_MEDIA_SIGNING_SECRET`) kaynağından HKDF ile türetilmiş anahtar kullanılır; hiçbiri yoksa eski v1 (kiracı tuzlu sha256) kullanılır. Geçiş dönemi: eski v1 özetler okunur, yeni kayıtlar v2 yazar (çift arama). **Anahtar DÖNDÜRÜLÜR/değişirse** mevcut v2 aranmasın özetleri eşleşmez; döndürmeden önce aranmasın listesi yeniden girilmelidir. `NEXT_PUBLIC_` DEĞİL |
| `ADVISOR_PII_KEY` | **Zorunlu** (danışman TC/IBAN alanlarını şifreler; `openssl rand -hex 32`, 64 hex). Yoksa bu alanlar kapalıdır. **Kaybedilirse** şifreli TC/IBAN geri gelmez: anahtarı güvenli yerde yedekle. `NEXT_PUBLIC_` DEĞİL |
| `PLATFORM_MFA_ENFORCEMENT` | **Yayın öncesi `on`** (platform personeli için zorunlu TOTP/2FA). Tanımsız/kapalıyken `/admin` üstünde "Geliştirme modu" şeridi görünür ve demo kartları süper admin girişi açabilir. Açıldıktan sonra redeploy |
| `IYZICO_BASE_URL` | **Canlı ödeme için `https://api.iyzipay.com`**. `.env.example` varsayılanı sandbox (`https://sandbox-api.iyzipay.com`): bu değerle üretimde GERÇEK ödeme alınmaz/yanlış ortama gidilir. Anahtarlar (`IYZICO_API_KEY`/`IYZICO_SECRET_KEY`) da canlı çiftle eşleşmeli |
| `EMLAKFIYATI_API_KEY` | **YEDEK**. Birincil kaynak Admin > Sistem > EmlakFiyati'nda girilen şifreli anahtardır (öncelik: admin > bu değişken). Piyasa endeksi için sunucu sırrı; `NEXT_PUBLIC_` DEĞİL. İkisi de yoksa özellik "etkin değil" der, hiçbir sayfa kırılmaz. Yalnız `emlakfiyati.com` hostuna HTTPS ile gider |
| `EVDS_API_KEY` | **Opsiyonel**. TCMB EVDS ücretsiz API anahtarı (HTTP başlığı `key` ile gider; sunucu sırrı, `NEXT_PUBLIC_` DEĞİL). Varsa `tcmb-kur` cron'unun ayrı bir adımı konut kredisi ağırlıklı ortalama faizi (`market_rates`, hesaplayıcı varsayılanı) ve TÜFE endeksinden 12 aylık ortalama değişimi (`tufe.table`, kaynak "TCMB EVDS (otomatik)", `official=false`) çeker. Yoksa hiçbir şey yapılmaz. Tablo için `20261012002000_market_rates` migration'ı gerekir |
| `EVDS_SERIES_HOUSING_LOAN`, `EVDS_SERIES_CPI` | Opsiyonel seri kodları. Varsayılanlar (`TP.KTF10`, `TP.FG.J0`) **DOĞRULANMADI**: anahtarla EVDS arayüzünden kodu teyit edip burada ezin. `EVDS_BASE_URL` (varsayılan `https://evds2.tcmb.gov.tr/service/evds`) EVDS3 geçişinde adres değişirse ayarlanır |

Release çifti her zaman **DB'de uygulanmış SON migration'a** çekilir (dosya sisteminde bekleyen/uygulanmamış bir dosyaya DEĞİL; yoksa `/api/health` 503 verir
ya da yanlış "hazır" gösterir). Üretimi (DB migrate sonrası, kod deploy öncesi):

```bash
npm run check:migrations -- --release
```

Çıktıdaki kimlik/checksum'ı `RELEASE_MIGRATION` / `RELEASE_MIGRATION_CHECKSUM` olarak Vercel'e yaz. DB'ye yeni migration uygulandığında bu çift
YENİDEN güncellenmezse `/api/health` migration uyumsuzluğu nedeniyle 503 döner. Depoya eklenen ama henüz uygulanmamış dosya çifti DEĞİŞTİRMEZ.

Opsiyonel: iyzico live anahtarları + live base URL, push, mesaj, AI, portal, banka oranı sağlayıcısı (`.env.example`).
DB araçları için `DATABASE_POOLER_URL` veya `DATABASE_URL` yalnız kontrollü runner'da; tarayıcıya/runtime'a taşınmaz.

**Demo bayrakları:** `PRODUCTION_DEMO_LOGIN_OPT_IN` ve `PRODUCTION_PLATFORM_DEMO_OPT_IN` yalnız geliştirme
aşamasında `true` olabilir (kod yalnız tam `true` değerini kabul eder; varsayılan kapalı); gerçek müşteri
kullanımına geçmeden önce kapatılır/silinir. `ENABLE_DEMO_LOGIN`, `ALLOW_PAYMENT_LINK_DEMO`, `ALLOW_BILLING_DEMO`
production'da kapalı/tanımsız olmalı. Public isimli (`NEXT_PUBLIC_*`) hiçbir değişken sır içermez.

**Platform MFA tek kaynak (ZORUNLU yayın adımı):** MFA iki yerde uygulanır: uygulama katmanı `PLATFORM_MFA_ENFORCEMENT=on` (env) ve
veritabanı katmanı `platform_settings` `platform.mfa_enforced` (SQL personel kapıları, örn. `growth_staff_super_admin()`, AAL2'yi YALNIZ bu
ayara bakarak ister; env'e bakamaz). İkisi AYNI ANDA açılır: env'i açtığınız anda
`insert into public.platform_settings (key, value) values ('platform.mfa_enforced', 'on') on conflict (key) do update set value = 'on';`
çalıştırın ve geri alırken ikisini birlikte kapatın. `/admin` üstündeki kırmızı "MFA tutarsız" şeridi env açık + ayar kapalı ise uyarır
(`platformMfaSyncIssue`, `src/lib/platform-mfa.ts`). Bu adım atlanırsa DB personel RPC'leri MFA'sız çalışır. Zorunlu MFA hâlâ KAPALI (sahip kararı).

## 3. Veritabanı

- [ ] Otomatik yedek/PITR durumu ve son başarılı yedek zamanı doğrulandı (restore edilebilirlik: `docs/runbooks/RESTORE.md`).
- [ ] `npm run check:migrations` (statik) ve `npm run check:migrations -- --database` (ledger/checksum, salt-okunur) temiz.
- [ ] `npm run db:migrate -- --dry-run` yalnız beklenen dosyaları gösteriyor (salt-okunur).
- [ ] Bakım penceresinde `npm run db:migrate`.
- [ ] `npm run check:migrations -- --database` tekrar: pending yok, checksum uyumlu.
- [ ] `npm run db:rls-audit` rollback'li ve temiz.
- [ ] Yeni storage bucket/policy ve Realtime publication doğrulandı.

Kurallar: migration'lar forward-only; uygulanmış dosya değiştirilmez; ledger drift varsa yazma yapılmaz;
düzeltme yeni migration ile. `--baseline` yalnız ledger'sız eski DB'yi tanıtmak içindir (önce yedek, dry-run kaydı).
Enum `ADD VALUE` + kullanımı aynı dosyada olamaz. Ayrıntı: `MIGRATION_GUIDE.md`.

## 4. Deploy sonrası doğrulama

- [ ] Deploy SHA'sı beklenen commit (Vercel `VERCEL_GIT_COMMIT_SHA`; başka hostta `RELEASE_SHA`).
- [ ] Public `/api/health` 200 ve `status=ready`; `Authorization: Bearer <HEALTHCHECK_SECRET>` ile release SHA,
      deployment id ve migration readiness doğru (secret'i loga yazma).
- [ ] Cron auth negatif testi (salt-okunur):
      `APP_URL=https://... npm run cron:smoke -- --auth-only`
- [ ] Public E2E uzak deploy'da geçti.
- [ ] Salt-okunur duman: `npm run smoke:live` (demo sahip + danışman ile /app dinamik olmayan tüm sayfalar: durum, "şu anda açılamadı" hata sınırı, >2,5 sn uyarı; `BASE=https://...`).
- [ ] Giriş, şifre sıfırlama, tenant izolasyonu, platform admin erişimi, ticket akışı kontrol edildi.
- [ ] Ödeme/webhook kullanılıyorsa imza doğrulama + tek test işlemi.
- [ ] `/admin/sistem` tüm planlı işleri gösteriyor; heartbeat eşikleri uygun.

Dikkat: `npm run cron:smoke` (argümansız) tüm işleri gerçekten tetikler ve veri değiştirir; yalnız onaylı doğrulamada.
CI'daki manuel `workflow_dispatch` hattı `app_url` ile aynı kontrolleri uzak deploy'a uygular;
`run_authorized_crons=true` mutating'dir, varsayılan kapalı.

## 5. Gözlem ve karar

- [ ] İlk 30 dk: error log, DB bağlantısı, auth, cron heartbeat.
- [ ] Release sahibi, izleme sahibi, rollback yetkilisi belli.
- [ ] Başarısızlıkta kod rollback'i: `docs/runbooks/GERI_DONUS.md`. Veri bütünlüğü etkilendiyse incident:
      `docs/runbooks/INCIDENT_RESPONSE.md`, restore: `docs/runbooks/RESTORE.md`. Kod rollback'i veri restore'u değildir.
- [ ] Release kaydına eklenir: CI run + SHA, migration dry-run + checksum sonucu, yetkili health sonucu,
      auth-only cron smoke + public E2E sonucu, ilk gözlem özeti.

## Cron

Tek kaynak `vercel.json`; route, zamanlama, auth guard, heartbeat ve `/admin/sistem` kapsamı `npm run check:cron`
ile doğrulanır.

## Anlık bildirim (Web Push / VAPID)

Push kanalı VAPID anahtarı olmadan sessizce kapalıdır (bildirimler yalnız zile düşer; Hesabım > Bildirimler "push kanalı kapalı" der).
Anahtarlar depoda TUTULMAZ ve kod tarafından üretilmez. Sunucuda bir kez, yerelde üretin (üçüncü tarafa gitmez):

```bash
npx web-push generate-vapid-keys
```

`.env.production` içine: `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public>`, `VAPID_PRIVATE_KEY=<private>`, `VAPID_SUBJECT=mailto:destek@emlaksoft.com.tr`.
Genel anahtar derleme anında pakete gömülür: anahtar eklendikten sonra yeniden derleme + deploy gerekir. Anahtar değişirse mevcut
abonelikler geçersizleşir (kullanıcılar Bildirimler sayfasındaki kartla yeniden açar). Deneme: Hesabım > Bildirimler > "Deneme gönder".
