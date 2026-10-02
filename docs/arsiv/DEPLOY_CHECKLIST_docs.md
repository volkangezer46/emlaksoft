> **ARŞİV — güncel kaynak: docs/ROADMAP.md** (durum: docs/DURUM.md, deploy: docs/DEPLOY.md). Bu belge tarihsel kayıttır; sayılar ve talimatlar eskimiş olabilir.

# Production Release Guide

Bu rehber Vercel + Supabase üretim hattının güncel sözleşmesidir. Rota ve
migration sayıları burada sabitlenmez; doğruluk doğrudan kaynak dosyalardan
üretilir.

## Ortam matrisi

| Grup | Production gereksinimi | Kaynak |
|---|---|---|
| Supabase | URL, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, server-only `SUPABASE_SECRET_KEY`; legacy anahtarlar kapalı | `.env.example` |
| Sunucu imzaları | `TWO_FACTOR_COOKIE_SECRET`, `OTP_HMAC_SECRET`, `PROPERTY_MEDIA_SIGNING_SECRET` (birbirinden ayrı, 32+ byte/karakter) | `.env.example` |
| Uygulama | `NEXT_PUBLIC_APP_URL`, `NEXT_DEPLOYMENT_ID` | `.env.example` |
| Release readiness | `RELEASE_MIGRATION`, `RELEASE_MIGRATION_CHECKSUM` | `npm run check:migrations -- --release` |
| Yönetim | `PLATFORM_ADMIN_EMAILS` | Kontrollü admin listesi |
| Cron | `CRON_SECRET` | Güçlü, bağımsız server secret |
| DB araçları | `DATABASE_POOLER_URL` veya `DATABASE_URL` | Yalnız kontrollü runner |
| Ödeme | iyzico live anahtarları ve live base URL | Sağlayıcı paneli |
| Opsiyonel servisler | Push, mesaj, AI, portal, değerleme | `.env.example` |

Production config yüklenirken Supabase URL + public/admin anahtarı, güçlü
`OTP_HMAC_SECRET`, HTTPS uygulama origin'i (`NEXT_PUBLIC_APP_URL` veya Vercel
production URL), güçlü `HEALTHCHECK_SECRET` ve biçimi geçerli release migration
kimliği/checksum çifti fail-fast doğrulanır. Ödeme, webhook, AI, mesaj ve portal
sağlayıcıları opsiyonel olduklarından bu evrensel boot kapısında zorunlu değildir.

`OTP_HMAC_SECRET` yeni giriş ve sözleşme imza kodlarını sürümlü HMAC olarak saklar.
Dağıtım anında hâlâ geçerli olabilecek eski SHA-256 kodları yalnız kendi beş dakikalık
süreleri boyunca doğrulanabilir; başarılı kullanımda silinir/null yapılır ve tüm yeni
kodlar HMAC biçimindedir. Pepper dönüşümünde aktif kodların yeniden isteneceği bir
beş dakikalık pencere planlanmalıdır; değer loglara veya istemci ortamına yazılmaz.

Vercel `VERCEL_GIT_COMMIT_SHA` değerini otomatik sağlar. Diğer hostlarda
`RELEASE_SHA` kullanılır. `DATABASE_*` bağlantıları tarayıcıya veya sıradan
runtime fonksiyonlarına taşınmaz.

## Migration akışı

```bash
npm run check:migrations
npm run db:migrate -- --dry-run
npm run db:migrate
npm run check:migrations -- --database
npm run db:rls-audit
```

`check:migrations` ad biçimini, yeni sıra çakışmalarını ve aynı içerikli SQL'i
statik kontrol eder. `--database` modu salt okunur biçimde ledger'daki her
checksum'ı diskle karşılaştırır ve pending migration varsa başarısız olur.
Uygulanmış bir migration değiştiğinde runner durur; geçmiş dosya düzenlenmez.

`--baseline` yalnız daha önce migration uygulanmış fakat ledger'ı olmayan bir
DB'yi sisteme tanıtmak içindir. Önce restore edilebilir yedek alınır, tüm şema
kanıtı gözden geçirilir ve dry-run çıktısı release kaydına eklenir.

## CI kapıları

Normal push/PR hattı:

- Tam geçmiş gitleaks
- Link, migration, cron ve Server Action statik sözleşmeleri
- TypeScript, sıfır lint warning, unit/contract testleri
- Advisory + sürüm + owner + expiry kontrollü dependency audit
- Yerel, non-mutating public Playwright E2E
- Production build

Manuel `workflow_dispatch` hattına deployed `app_url` verildiğinde:

- `/api/health` readiness
- Bütün cron uçlarında yetkisiz 401 kontrolü
- Remote public E2E
- DB secret mevcutsa migration checksum ve rollback'li RLS audit
- `run_authorized_crons=true` seçilirse ayrıca bütün gerçek cron işleri

Son madde mutating'dir ve varsayılan olarak kapalıdır.

## Deploy sonrası sağlık sözleşmesi

`GET /api/health` cache'lenmez. Yetkisiz/public istek yalnızca genel readiness
durumunu (`ok`, `status`, `db`, `ms`, `at`) döndürür. Aşağıdaki operasyonel
ayrıntılar sadece `Authorization: Bearer <HEALTHCHECK_SECRET>` ile alınır:

- `checks.database`: bağlantı durumu ve gecikme
- `checks.migrations`: expected/applied version, checksum ve readiness
- `release.sha`: deploy commit SHA'sı
- `release.deploymentId`: build/deployment kimliği

Expected migration/checksum çiftinden biri eksikse, ledger kaydı yoksa ya da
checksum farklıysa endpoint 503 döner. Expected migration tanımlı değilse DB sağlığı çalışmaya
devam eder fakat migration durumu `observed/unknown` olur; production release
kapısı için iki release env değeri de tanımlanmalıdır.

## Cron doğrulama

`vercel.json`, route klasörleri, `src/lib/cron-jobs.ts`, auth guard ve heartbeat
adları `npm run check:cron` ile birebir tutulur. Admin paneli sabit 24 saat
yerine her görevin gerçek sıklığına göre gecikme hesaplar.

```bash
# Salt okunur auth negatif testi
APP_URL=https://app.example.com npm run cron:smoke -- --auth-only

# Mutating: tüm işleri gerçek secret ile çalıştırır
APP_URL=https://app.example.com CRON_SECRET=... npm run cron:smoke
```

## Yayın kararı

Yayın sahibi aşağıdaki kanıtları release kaydına ekler:

1. CI run bağlantısı ve deploy SHA.
2. Migration dry-run + database checksum sonucu.
3. Yetkili `/api/health` sonucu (secret'i loglamadan veya çıktıya eklemeden).
4. Auth-only cron smoke ve public E2E sonucu.
5. İlk gözlem penceresindeki hata/heartbeat özeti.

Rollback, incident ve restore adımları `docs/runbooks/` altındadır. Kod rollback'i
ile veri restore'u aynı işlem değildir; veri restore'u yalnız incident komutası
ve doğrulanmış backup ile yapılır.
