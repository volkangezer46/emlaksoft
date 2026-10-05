# EmlakSoft — Deploy Rehberi (tek kaynak)

Vercel + Supabase üretim hattı. Bu belge eski iki checklist'i birleştirir
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
| `OTP_HMAC_SECRET` | Bağımsız, >=32 byte; diğer sırlarla paylaşılmaz. Değişirse aktif OTP'ler için 5 dk pencere planla |
| `TWO_FACTOR_COOKIE_SECRET` | Bağımsız, >=32 karakter |
| `PROPERTY_MEDIA_SIGNING_SECRET` | Bağımsız, >=32 karakter |
| `HEALTHCHECK_SECRET` | >=32 karakter; yetkili `/api/health` ayrıntısı için |
| `CRON_SECRET` | Güçlü, bağımsız; tüm cron route'ları Bearer doğrular |
| `RELEASE_MIGRATION`, `RELEASE_MIGRATION_CHECKSUM` | **Yeni migration sonrası güncellenir** (aşağıda) |
| `PLATFORM_ADMIN_EMAILS` | En az iki kontrollü yönetici önerilir |
| `EMLAKFIYATI_API_KEY` | Piyasa endeksi (EmlakFiyati) için sunucu sırrı; `NEXT_PUBLIC_` DEĞİL. Eksikse özellik "etkin değil" der, hiçbir sayfa kırılmaz (değerleme/bölge analizi kaynağı atlanır). Yalnız `emlakfiyati.com` hostuna HTTPS ile gider |

Release çifti üretimi (DB migrate sonrası, kod deploy öncesi):

```bash
npm run check:migrations -- --release
```

Çıktıdaki kimlik/checksum'ı `RELEASE_MIGRATION` / `RELEASE_MIGRATION_CHECKSUM` olarak Vercel'e yaz. Yeni migration
eklendiğinde bu çift YENİDEN güncellenmezse `/api/health` migration uyumsuzluğu nedeniyle 503 döner.

Opsiyonel: iyzico live anahtarları + live base URL, push, mesaj, AI, portal, banka oranı sağlayıcısı (`.env.example`).
DB araçları için `DATABASE_POOLER_URL` veya `DATABASE_URL` yalnız kontrollü runner'da; tarayıcıya/runtime'a taşınmaz.

**Demo bayrakları:** `PRODUCTION_DEMO_LOGIN_OPT_IN` ve `PRODUCTION_PLATFORM_DEMO_OPT_IN` yalnız geliştirme
aşamasında `true` olabilir (kod yalnız tam `true` değerini kabul eder; varsayılan kapalı); gerçek müşteri
kullanımına geçmeden önce kapatılır/silinir. `ENABLE_DEMO_LOGIN`, `ALLOW_PAYMENT_LINK_DEMO`, `ALLOW_BILLING_DEMO`
production'da kapalı/tanımsız olmalı. Public isimli (`NEXT_PUBLIC_*`) hiçbir değişken sır içermez.

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
- [ ] Giriş, şifre sıfırlama, tenant izolasyonu, platform admin erişimi, ticket akışı kontrol edildi.
- [ ] Ödeme/webhook kullanılıyorsa imza doğrulama + tek test işlemi.
- [ ] `/admin/sistem` tüm planlı işleri gösteriyor; heartbeat eşikleri uygun.

Dikkat: `npm run cron:smoke` (argümansız) tüm işleri gerçekten tetikler ve veri değiştirir; yalnız onaylı doğrulamada.
CI'daki manuel `workflow_dispatch` hattı `app_url` ile aynı kontrolleri uzak deploy'a uygular;
`run_authorized_crons=true` mutating'dir, varsayılan kapalı.

## 5. Gözlem ve karar

- [ ] İlk 30 dk: error log, DB bağlantısı, auth, cron heartbeat.
- [ ] Release sahibi, izleme sahibi, rollback yetkilisi belli.
- [ ] Başarısızlıkta kod rollback'i: `docs/runbooks/ROLLBACK.md`. Veri bütünlüğü etkilendiyse incident:
      `docs/runbooks/INCIDENT_RESPONSE.md`, restore: `docs/runbooks/RESTORE.md`. Kod rollback'i veri restore'u değildir.
- [ ] Release kaydına eklenir: CI run + SHA, migration dry-run + checksum sonucu, yetkili health sonucu,
      auth-only cron smoke + public E2E sonucu, ilk gözlem özeti.

## Cron

Tek kaynak `vercel.json`; route, zamanlama, auth guard, heartbeat ve `/admin/sistem` kapsamı `npm run check:cron`
ile doğrulanır.
