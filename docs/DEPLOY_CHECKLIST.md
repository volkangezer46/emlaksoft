# EmlakSoft — Canlıya Alma Rehberi (Deploy Checklist)

**Tarih:** 2026-07-26 · **Durum:** ✅ **CANLIDA — 2026-07-27**: `https://emlaksoft.vercel.app` (Vercel projesi `emlaksoft`). Env: Supabase üçlüsü + CRON_SECRET + PLATFORM_ADMIN_EMAILS + NEXT_PUBLIC_APP_URL yüklü; demo kapıları kapalı. DB: mevcut Supabase projesi (107 migration). Duman testi geçti (public sayfalar 200, cron secret'sız 401, geçersiz token 404 sayfası). Kalan manuel adımlar aşağıda işaretli.
**Kaynak doğrulama:** `.env.local.example`, kod içi `process.env` taraması, `vercel.json`, `supabase/migrations/`, `MIGRATION_GUIDE.md`.
Eski kök `DEPLOY_CHECKLIST.md` (2026-07-24) bu belgeyle geçersizdir.

---

## A) Ortam değişkenleri envanteri (kodda geçen TAM liste)

### A1. Zorunlu — bunlar olmadan uygulama çalışmaz

| Değişken | Ne işe yarar | Nereden alınır |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Tarayıcı + sunucu Supabase bağlantısı | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | RLS'e tabi istemci anahtarı | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Sunucu tarafı admin client (cron, storage, bootstrap) | Supabase → Project Settings → API (**gizli — asla client'a sızmamalı**) |
| `NEXT_PUBLIC_APP_URL` | Mutlak URL üreten her şey: şifre maili, paylaşım/imza/portal linkleri, OG image | Prod domain, örn. `https://app.emlaksoft.com.tr` |
| `CRON_SECRET` | **13 cron'un tamamı** bunu `Authorization: Bearer` ile doğrular. Prod'da (`NODE_ENV=production`) secret tanımsızsa cron'lar **401 döner ve hiçbiri çalışmaz** — prod'da fiilen zorunlu. Vercel, tanımlıysa cron isteklerine header'ı otomatik ekler. | `openssl rand -hex 32` üret, Vercel env'e koy |
| `DATABASE_POOLER_URL` (veya `DATABASE_URL`) | Yalnız migration/seed scriptleri (`scripts/apply-one.ts`, `apply-migrations.ts`, `rls-audit.ts`). Vercel runtime'da gerekmez; migration'ı çalıştıran makinede gerekir. | Supabase → Database → Connection string → Transaction pooler (6543) |

### A2. Ödeme — iyzico (canlı abonelik için zorunlu)

| Değişken | Not |
|---|---|
| `IYZICO_API_KEY` / `IYZICO_SECRET_KEY` / `IYZICO_MERCHANT_ID` | iyzico merchant panelinden **LIVE** anahtarlar |
| `IYZICO_BASE_URL` | **DİKKAT:** kod varsayılanı `https://sandbox-api.iyzipay.com` (`src/lib/billing/iyzico.ts`). Prod'da mutlaka `https://api.iyzipay.com` set edilmeli, yoksa canlıda sandbox'a gider. |
| `ALLOW_PAYMENT_LINK_DEMO` / `ALLOW_BILLING_DEMO` | Demo ödeme kaçış kapıları — prod'da **tanımsız bırak / 0** |

### A3. Push bildirim — VAPID (PWA push kullanılacaksa zorunlu üçlü)

| Değişken | Not |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` ile bir kez üretilir; sonradan değişirse mevcut abonelikler ölür |
| `VAPID_SUBJECT` | `mailto:destek@...` biçiminde iletişim adresi |

### A4. AI katmanı (yoksa AI özellikleri "bağlantı bekliyor" gösterir)

| Değişken | Not |
|---|---|
| `OPENAI_API_KEY` | Asistan, brifing özeti, içerik üretimi, belge OCR |
| `OPENAI_MODEL` | Opsiyonel; varsayılan `gpt-4o-mini` |
| `OPENAI_VISION_MODEL` | Opsiyonel; OCR için, varsayılan `OPENAI_MODEL` → `gpt-4o-mini` |

### A5. Değerleme / tapu sağlayıcıları (opsiyonel — emsal motoru API'siz de çalışır)

| Değişken | Not |
|---|---|
| `ENDEKSA_CLIENT_ID` / `ENDEKSA_CLIENT_SECRET` / `ENDEKSA_BASE_URL` | Endeksa API anlaşması sonrası |
| `TAPUSOR_API_KEY` / `TAPUSOR_BASE_URL` | Tapusor API anlaşması sonrası |

### A6. SMS — Netgsm (platform varsayılanı)

| Değişken | Not |
|---|---|
| `NETGSM_USERCODE` / `NETGSM_PASSWORD` / `NETGSM_MSGHEADER` | Platform geneli fallback. Tenant kendi Netgsm bilgisini uygulama içi entegrasyon formundan girerse o öncelikli (`src/lib/messaging/netgsm.ts` parametre → env sırası). 2FA SMS'i ve OTP imza için prod'da en az platform hesabı gerekli. |

### A7. Platform yönetimi + dev/test

| Değişken | Not |
|---|---|
| `PLATFORM_ADMIN_EMAILS` | Super admin e-postaları (virgülle). Prod'da gerçek admin adresi. |
| `ENABLE_DEMO_LOGIN` | **Prod'da asla set etme** — demo giriş kapısı |
| `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`, `APP_URL`, `CI` | Yalnız test/scriptler; Vercel'e koyma |

### A8. Henüz pasif entegrasyon iskeletleri (env tanımlansa da anlaşma yoksa çalışmaz)

`WHATSAPP_API_URL` / `WHATSAPP_API_TOKEN` · `SAHIBINDEN_API_KEY` · `ZINGAT_API_KEY` · `HEPSIEMLAK_API_KEY` · `EFATURA_PROVIDER` / `EFATURA_API_URL` / `EFATURA_API_KEY` / `EFATURA_COMPANY_VKN`

---

## B) Supabase prod kurulumu

1. **Yeni prod projesi** oluştur (bölge: `eu-central-1` — Vercel bölgesiyle eşleşsin).
2. **Migration'lar sırayla** (79 dosya, `supabase/migrations/` dosya adı sırası):
   ```bash
   # .env.local'de prod DATABASE_POOLER_URL ile, tek tek ve sırayla:
   npx tsx scripts/apply-one.ts supabase/migrations/20260721000000_init.sql
   # ... 20260726000078_realtime_publication.sql'e kadar
   ```
   `scripts/apply-migrations.ts` sabit listeli ve **eksik** (ROADMAP F2) — güvenme, `apply-one.ts` kullan.
3. **Storage bucket'ları** — kodda kullanılanlar (`storage.from` taraması): `customer-files` ve `property-media`, ikisi de **private**.
   - `property-media`: migration `000021` SQL ile oluşturur — elle iş yok. Erişim service_role + `/api/property-media/[id]` üzerinden.
   - `customer-files`: **elle** oluştur (Dashboard → Storage → New bucket, private) + RLS policy — adımlar `MIGRATION_GUIDE.md` içinde.
4. **Realtime publication**: migration `078` altı tabloyu (`notifications, deals, commissions, portal_listings, customers, support_ticket_messages`) `supabase_realtime` publication'ına ekler. **Idempotent** — deploy'da tekrar koşabilir; yine de Dashboard → Database → Publications'tan 6 tablonun listede olduğunu doğrula.
5. **Auth ayarları**: Site URL = prod domain; Redirect URLs'e `https://<domain>/sifre-yenile` ekle (şifre sıfırlama maili buraya döner, `src/app/actions/password-reset.ts`). E-posta şablonlarını Türkçeleştir.
6. **Geo seed**: `000001_geo_seed.sql` + `000017` migration'la gelir; ek il/ilçe güncellemesi için `npm run geo:sync`.
7. **Platform admin bootstrap**: `npx tsx scripts/bootstrap-platform-admin.ts` (prod env ile) + `PLATFORM_ADMIN_EMAILS`.
8. Demo kullanıcı/persona prod'a **taşınmaz**; `ENABLE_DEMO_LOGIN` tanımsız.

---

## C) Vercel

- **Build:** `next build` (varsayılan; özel komut yok). Node `>=22`, npm `>=11.18` (`package.json engines`).
- **Bölge:** `fra1` (Frankfurt) öner — Supabase `eu-central-1` ile aynı kıta; fonksiyon bölgesini proje ayarından sabitle.
- **Cron:** `vercel.json`'da **13 cron** tanımlı. **Plan limiti uyarısı:** Hobby plan'da cron sayısı ve sıklığı kısıtlıdır (Hobby: yalnız günlük tetikleme; `*/30 * * * *` gibi tarifeler çalışmaz) — 13 cron'un tam tarifeyle çalışması için **Pro plan** gerekir.
  | Cron | Tarife | Görev |
  |---|---|---|
  | `gunluk-ozet` | 07:00 | Günlük ofis özeti bildirimi |
  | `randevu-hatirlat` | 30 dk'da bir | Yaklaşan randevu hatırlatma |
  | `gorev-hatirlat` | 2 saatte bir | Görev vadesi hatırlatma |
  | `portal-teyit` | 6 saatte bir | Portal ilan teyit döngüsü |
  | `abonelik-kontrol` | 00:00 | Abonelik durum/geçiş kontrolü |
  | `leak-sla` | 12 saatte bir | Kayıp-kaçak SLA takibi |
  | `dogum-gunu` | 08:00 | Müşteri doğum günü bildirimi |
  | `tcmb-kur` | 13:30 hafta içi | TCMB kur çekimi |
  | `otomasyon` | 06:00 + 14:00 | Otomasyon motoru zamanlı tetikleyiciler |
  | `bolge-snapshot` | ayın 1'i 03:00 | Bölge istatistik anlık görüntüsü |
  | `vitrin-eslesme` | 10:00 | Vitrin kayıtlı arama eşleşme bildirimi |
  | `dunning` | 09:00 | Başarısız ödeme takip (dunning) |
  | `kira-tahakkuk` | 05:00 | Kira tahakkuk üretimi |
- Tüm env değişkenlerini Production scope'a gir; `NEXT_PUBLIC_*` olanların build sırasında mevcut olduğundan emin ol.

---

## D) Deploy sonrası duman testi

1. `npm run type-check` + `npm run build` lokalde yeşil (deploy öncesi son kontrol).
2. **Giriş akışı:** kayıt → giriş → (2FA açık kullanıcıda SMS kodu) → `/app` dashboard yükleniyor; şifre sıfırlama maili `/sifre-yenile`'ye dönüyor.
3. **Vitrin/public:** `/` landing, `/vitrin/<slug>`, `/demo` formu, KVKK/politika sayfaları, `robots.txt` + `sitemap.xml`.
4. **Token sayfaları:** `/paylas/[token]`, `/musteri-portali/[token]`, `/malik-portali/[token]`, `/imza/[token]`, `/odeme-link/[token]`, `/degerleme-raporu/[token]` — geçersiz token'da düzgün hata.
5. **Cron elle GET** (13'ünün her biri):
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/gunluk-ozet
   # secret'sız istek 401 dönmeli (negatif test)
   ```
   Ardından admin cron sağlık panosunda heartbeat'lerin düştüğünü gör (`cron_heartbeats`). `npm run cron:smoke` alternatif.
6. **E2E smoke:** `npm run test:e2e` (Playwright, 7 public smoke) prod URL'e karşı (`APP_URL` ile).
7. **Realtime:** iki tarayıcıda bildirim zili / destek mesajı canlı düşüyor mu (publication kontrolü fiilen).
8. **Ödeme:** iyzico LIVE ile 1 TL'lik gerçek test ödemesi + iade; `ALLOW_*_DEMO` kapalıyken demo yolun 403/404 verdiğini doğrula.
9. **PWA:** manifest + `sw.js` yükleniyor, offline sayfası çalışıyor; push aboneliği alınıp test bildirimi gidiyor.

---

## E) Güvenlik son kontrol

- [ ] **Sır rotasyonu (ROADMAP F5):** dev sürecinde sohbette paylaşılmış `service_role` key + DB şifresi **prod'a taşınmadan önce Supabase'te rotate edilir**; prod projesi zaten yeni anahtar üretir ama dev projesi de rotate edilmeli.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` yalnız server'da; hiçbir `NEXT_PUBLIC_*` değişkende sır yok.
- [ ] `CRON_SECRET` set + 401 negatif testi geçti (yukarıda D5).
- [ ] **2FA davranışı:** SMS 2FA açık kullanıcı Netgsm olmadan giremez — prod'da Netgsm platform hesabı hazır olmadan 2FA'yı tenant'lara duyurma.
- [ ] RLS denetimi: `npm run db:rls-audit` prod DB'ye karşı temiz.
- [ ] `npm audit` kritik açık yok (sharp/postcss override'ları `package.json`'da).
- [ ] Demo kapıları kapalı: `ENABLE_DEMO_LOGIN`, `ALLOW_PAYMENT_LINK_DEMO`, `ALLOW_BILLING_DEMO` tanımsız.
- [ ] Supabase yedekleme (PITR/daily backup) açık + bir kez geri yükleme provası (ROADMAP Q5).
