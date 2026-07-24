# EmlakSoft — Devir & Süreklilik Dosyası

> **Son güncelleme:** 23 Temmuz 2026  
> **Proje yolu:** `C:\Users\volka\Projects\emlaksoft`  
> **Amaç:** Cursor / VS Code’da yeni sohbette bu dosyayı okutup kaldığın yerden devam etmek.

---

## VS Code / Cursor’da ne yazmalısın?

Yeni Agent sohbetinde **şunu olduğu gibi yapıştır:**

```
@DEVIR_TESLIM.md dosyasını oku. EmlakSoft projesinde kaldığımız yerden devam et.
Tüm kuralları, sözlüğü, biten işleri ve sıradaki adımları uygula. Onay beklemeden devam et.
```

İstersen daha kısa:

```
@DEVIR_TESLIM.md oku ve devam et
```

### Nasıl çalışır?
1. Cursor’da bu proje klasörünü aç: `C:\Users\volka\Projects\emlaksoft`
2. Yeni Agent sohbeti aç
3. Yukarıdaki metni yapıştır (`@DEVIR_TESLIM.md` dosyayı bağlar)
4. Agent dosyadaki geçmişi, kuralları ve sıradaki işleri yükler

---

## Ürün kimliği

**EmlakSoft** — Türkiye emlak ofisleri için premium abonelikli CRM / ofis yönetim platformu.

- Ofis paneli: `/app`
- EmlakSoft personel paneli: `/admin`
- Aynı giriş kapısı: `/giris` — personel → `/admin`, ofis kullanıcısı → `/app`
- Rakip / ilham: HGDekor admin zenginliği + Tapusor / Endeksa özellik vurgusu

---

## Dil & ürün sözlüğü (ZORUNLU)

Kullanıcıya görünen **tüm metinlerde** İngilizce ürün kelimesi yok. Kod/tablo/rota adları İngilizce kalabilir.

| Kullanma | Kullan |
|----------|--------|
| tenant | ofis |
| lead | aday / aday müşteri |
| ticket | destek talebi |
| dashboard | kontrol paneli |
| MRR | aylık yinelenen gelir |
| ARR | yıllık yinelenen gelir |
| ARPA | ofis başına ortalama gelir |
| churn | müşteri kaybı |
| trial | deneme |
| Ops / Staff | Operasyon / Personel |
| CSV | Excel'e aktar |
| fallback | yedek kip |
| KPI | gösterge / canlı veri |
| Impersonation | Ofis kimliğiyle önizleme |
| Offboarding | Ayrılış & arşiv |
| webhook (UI) | bağlantı uç noktası |
| AI (UI) | yapay zeka |

**Kural:** Yeni ekran/etiket yazarken bu sözlüğe uy. Kod tanımlayıcılarını (`tenants` tablosu, `/admin/tenants` yolu, `convertDemoToTenant`) bozma.

---

## Mimari özet

### Roller
**Platform personeli** (`platform_staff`): `super_admin`, `ops`, `support`, `billing`  
Modül matrisi: `src/lib/platform-access.ts`  
Guard: `requirePlatformModule("...")`

**Ofis kullanıcıları** (`profiles`): owner, manager, advisor vb. — tenant RBAC + `permissions`

### Son migration'lar (uygulandı)
- `000023` — `demo_requests` (satış CRM)
- `000024` — `platform_notifications` (personel bildirimi)
- `000025` — `platform_settings` (OpenAI anahtarı vb.)
- `000026` — `advisor_sessions` + `advisor_messages` (danışman sohbet geçmişi)
- `000027` — `platform_audit_logs` (platform personel işlem kaydı)

Rehber: `MIGRATION_GUIDE.md`  
Tek dosya uygula: `npx tsx scripts/apply-one.ts supabase/migrations/<dosya>.sql`

---

## Bu sohbette tamamlanan işler

### 13) Kapsamlı kalite turu (24 Temmuz 2026)

**Build: ✓ 0 hata, 69 sayfa**

#### Kontrol edilip tamamlanmış bulunanlar
- `/app/*` tüm loading.tsx'ler — mevcut ✅
- Error boundary — app layout'ta `<ErrorBoundary>` sarılı, admin'de `error.tsx` var ✅
- `/app/portallar` teyit butonu — `confirmPortalListing` form action mevcut ✅
- Bildirim tercihleri UI — `<NotificationPrefsPanel>` ayarlar sayfasında mevcut ✅
- `/admin/personel` — tam dolu, personel ekleme/rol/pasif yönetimi çalışıyor ✅

#### Deploy doküman güncellemeleri (DEPLOY_CHECKLIST.md)
- iyzico webhook prod test talimatı (sandbox kart, imza curl komutu)
- Cron job listesi (6 job, vercel.json hazır)
- Supabase Storage bucket kurulum SQL + RLS policy
- Değerleme API prod test adımları

#### Müşteri 360 iletişim sekmesi
- `customer-360-tabs.tsx`'e `iletisim` sekmesi eklendi
- `CommunicationTimeline` component sekme içinde render ediliyor
- `page.tsx`'ten bağımsız render kaldırıldı, `communications` + `canCreateComm` prop üzerinden geçiyor

#### Price Health motoru genişletme
- `src/lib/price-health.ts` — 50+ il/ilçe m² referans tablosu (İstanbul ilçeleri dahil)
- Kira/satış için farklı m² fiyat hesabı (`transactionType` parametresi)
- Eşikler %8/%15 → %10/%20 (yüksek enflasyon ortamına uygun)
- `overrideSqmPrice` parametresi — Endeksa/Tapusor canlı verisiyle override

#### Admin topbar arama genişletme
- `command-palette.tsx` — `w-full` (max-w sınırı yok), `Ctrl K` badge shrink-0
- `admin-topbar.tsx` — sol logo bölümü `w-52 shrink-0`, arama `flex-1`

#### Font + build optimizasyonu
- `layout.tsx` — Manrope weight azaltıldı, latin-ext kaldırıldı, Geist Mono preload: false
- `next.config.ts` — `cacheMaxMemorySize: 0` disk cache'e devret
- Build süresi: ~21s → ~11s

#### Sıradaki vizyon adımları (kod gerektiren, ertelendi)
- **PWA Push** — VAPID keys: `npx web-push generate-vapid-keys` → Vercel'e NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT ekle. `push_subscriptions` tablosu + SW handler hazır, sadece prod anahtarları eksik.
- **CTI entegrasyonu** — Gelen çağrıyı müşteriye otomatik eşleştirme. Provider: Netgsm/Bulutfon. `src/lib/messaging/netgsm.ts` iskelet var. Eklenecek: webhook endpoint + müşteri telefon normalize eşleştirme.
- **Mobile app** — React Native + Expo. Mevcut API route'ları hazır. Supabase Auth + RLS aynı. Öncelik: müşteri ekleme, çağrı kaydı, portföy listeleme.
- **Unit test** — Kritik action'lar için Jest iskelet: `bulkUpdatePropertyStatus`, `requirePermission`, `computePriceHealth`. `package.json`'a `jest` + `@testing-library/react` eklenecek.
- **useApi migration** — `src/app/admin/personel/page.tsx` hâlâ `fetch("/api/admin/personel")` direkt kullanıyor. `useAppApi` hook'una taşınabilir ama işlevsel, öncelik düşük.
- **IBAN alanı** — `tenants` tablosuna `iban` kolonu + `updateTenantInfo` action + `company-form.tsx` alan eklenmesi gerekiyor (migration gerektirir).

---

### 12) Eksik görevler 3D + 3E tamamlandı (24 Temmuz 2026)

**Build: ✓ 0 hata, 69 sayfa**

#### 3D — Dashboard yetki belgesi uyarısı
- `src/app/app/page.tsx` — `properties.authority_expires_at` kolonu paralel sorguya eklendi
- 15 gün içinde dolacak portföyler varsa hero card üstünde amber uyarı kartı gösterilir
- 5 gün veya daha az kalanlar kırmızı bold ile vurgulanır
- Portföy adı tıklanınca ilgili portföy detay sayfasına gider

#### 3E — Portföy toplu durum güncelleme
- `src/app/actions/bulk-property.ts` — `bulkUpdatePropertyStatus` server action
- `src/app/app/portfoyler/property-bulk-actions.tsx` — checkbox listesi + durum dropdown client component
- `src/app/app/portfoyler/page.tsx` — `PropertyBulkActions` import edildi; portföy listesinin üstüne `<details>` accordion içinde entegre edildi
- Tek seferde max 50 portföy, durum geçmişi + audit log yazılır, `revalidatePath` ile sayfa yenilenir

---

### 11) Performans optimizasyonu + eksik özellikler (23 Temmuz 2026)

**Build: ✓ 0 hata, 69 sayfa**

#### Sorgu optimizasyonları (Görev 1)
- `src/app/app/komisyon/page.tsx` — `.limit(100)` zaten vardı ✅
- `src/app/app/arama/page.tsx` — customers limiti + demands limiti ✅
- `src/app/app/raporlar/page.tsx` — commissions/closures/portals limit eklendi ✅
- `src/app/app/eslestirme/page.tsx` — demands `.limit(80)`, properties `.limit(120)` zaten vardı ✅
- `src/app/app/franchise/page.tsx` — tüm sorgulara limit eklendi (properties/customers 2000, deals 500 vb.) ✅
- `src/app/admin/billing/page.tsx` — subscriptions `.limit(500)` eklendi ✅
- `src/app/admin/tenants/page.tsx` — tenants `.limit(500)`, profiles `.limit(2000)` ✅
- `src/app/admin/raporlar/page.tsx` — tenants/subs/tickets limitleri ✅

#### Admin loading.tsx dosyaları (Görev 1)
- `src/app/admin/billing/loading.tsx` ✅
- `src/app/admin/tenants/loading.tsx` ✅
- `src/app/admin/raporlar/loading.tsx` ✅
- `src/app/admin/aktivite/loading.tsx` ✅
- `src/app/admin/tickets/loading.tsx` ✅
- `src/app/admin/satis/loading.tsx` ✅
- `src/app/admin/personel/loading.tsx` ✅

#### App loading.tsx dosyaları (Görev 1)
- Tüm eksik `/app/*` alt dizinlerine tek satır geçerli loading.tsx eklendi (28 dosya) ✅

#### next.config.ts optimizasyonu (Görev 2)
- `remotePatterns` ile Supabase storage CDN domain eklendi
- `deviceSizes` + `imageSizes` tanımlandı
- `optimizePackageImports`'a Radix UI primitive'leri eklendi
- Cache-Control header'ları: statik (`immutable`), API (`no-store`), app/admin (`private no-store`), public sayfalar (`SWR`) ✅

#### Eksik özellikler (Görev 3)
- **3A — Müşteri 360 portföy öneri widget'ı**: `src/app/app/musteriler/[id]/matched-properties-widget.tsx` — müşterinin aktif taleplerini portföylerle skor ≥ 45 ile eşleştirir, üst 6'yı gösterir ✅
- **3B — Portföy tam metin arama**: `portfoyler/page.tsx` sunucu tarafında `ilike` filtresi eklendi (`property_code`, `title` kolonları) ✅
- **3C — Müşteri kaynak raporu**: `raporlar/page.tsx` — `customers.source` sorgusunu paralel çeker, bar grafikle kaynak dağılımını gösterir ✅

### 10) Admin aktivite kaydı + danışman sohbet export (23 Temmuz 2026)
- `supabase/migrations/20260723000027_platform_audit_logs.sql` — `platform_audit_logs` tablosu, RLS (platform_staff okur, service_role yazar) → production'a uygulandı ✅
- `src/lib/platform-activity.ts` — `logPlatformActivity()` fire-and-forget helper
- `src/app/actions/platform-staff.ts` — `addPlatformStaff`, `updateStaffRole`, `deactivateStaff`, `reactivateStaff` her işlem sonrası `platform_audit_logs`'a kayıt yazar
- `src/app/actions/integrations.ts` — Endeksa/Tapusor anahtar save/clear işlemleri audit kaydı ekler
- `src/lib/admin-format.ts` — `auditActionLabel()` haritasına platform staff + entegrasyon etiketleri eklendi
- `src/app/admin/aktivite/page.tsx` — `audit_logs` + `platform_audit_logs` birleşik, tarihe göre sıralı, `UserCog` ikonu platform işlemlerini ayırt eder
- `src/app/admin/danisman/advisor-chat.tsx` — başlık barına `Download` butonu; mesaj varken görünür, client-side TXT export (sohbet başlığı + mesajlar)
- Build: ✓ 0 hata, 60 sayfa

### 9) Migration uygulama + değerleme DB anahtar düzeltmesi (23 Temmuz 2026)
- `supabase/migrations/20260723000026_advisor_sessions.sql` → production DB'ye uygulandı ✅
- `src/app/app/degerleme/page.tsx`: `isEndeksaConfigured()` → `isEndeksaConfiguredFull()`, `isTapusorConfigured()` → `isTapusorConfiguredFull()` — DB'den anahtar tanımlanınca değerleme rozeti otomatik yeşil olur
- Build: ✓ 0 hata, 60 sayfa

### 8) Endeksa/Tapusor anahtar yönetimi + danışman sohbet geçmişi (23 Temmuz 2026)
- `src/app/actions/integrations.ts` — Endeksa (clientId+secret) ve Tapusor (apiKey) DB'ye kaydetme/silme action'ları
- `src/lib/integrations/endeksa.ts` — `getEndeksaConfigFull()` / `isEndeksaConfiguredFull()` (DB öncelikli async)
- `src/lib/integrations/tapusor.ts` — `getTapusorConfigFull()` / `isTapusorConfiguredFull()` (DB öncelikli async)
- `src/components/admin/integration-keys-form.tsx` — `EndeksaKeyForm` + `TapusorKeyForm` client component'leri
- `src/app/admin/sistem/page.tsx` — Endeksa + Tapusor form kartları eklendi, DB'den masked gösterim
- `supabase/migrations/20260723000026_advisor_sessions.sql` — `advisor_sessions` + `advisor_messages` tabloları, RLS, trigger
- `src/app/actions/ai-advisor.ts` — `askAdvisor` DB'ye oturum+mesaj kaydeder; `listAdvisorSessions`, `loadAdvisorSession`, `deleteAdvisorSession` eklendi
- `src/app/admin/danisman/advisor-chat.tsx` — Sol sidebar (geçmiş oturum listesi, sil, yeni sohbet), geçmiş yükleme, aktif oturum takibi
- Build: ✓ 0 hata, 60 sayfa

### 7) UI Türkçeleştirme — /app paneli (23 Temmuz 2026)
- `anlasmalar/page.tsx`: "Deal board" → "Anlaşma tahtası"
- `portfoyler/[id]/property-workflow.tsx`: "Deal + komisyon" → "Anlaşma + komisyon" (başlık, buton, toast, açıklama)
- `denetim/page.tsx`: "Ops impersonation" → "Ofis önizleme başladı", "Impersonation bitti" → "Ofis önizleme bitti"
- `ayarlar/page.tsx`: hızlı bağlantı "Deal board" → "Anlaşma tahtası"
- `franchise/page.tsx` + `raporlar/page.tsx`: "Franchise BI" → "Şube analitiği", "Gerçek şube rollup" → "Şube bazlı konsolide"
- `ops-impersonation-banner.tsx`: "Impersonation'ı bitir" → "Önizlemeyi bitir"
- `komisyon/page.tsx`: ExportCsvButton label "CSV" → "Dışa aktar"
- Build: ✓ 0 hata, 57 sayfa


### 1) Rol bazlı admin paneli
- Personel rolüne göre farklı kontrol paneli (`/admin`, billing-home, support-home)
- Gruplu sidebar + topbar + Ctrl+K komut paleti
- CountUp, Sparkline, ExportButton

### 2) Satış CRM
- `/admin/satis` — demo talepleri, durum, atama, not
- Demo formu → `demo_requests` + personel bildirimi
- **Ofise dönüştür:** `convertDemoToTenant` — ofis + sahip kullanıcı + 14 gün deneme + geçici şifre

### 3) Bildirim merkezi
- Topbar zili + `/admin/bildirimler`
- `notifyPlatformStaff()` — demo, destek talebi, dönüşüm

### 4) Yapay zeka iş danışmanı
- `/admin/danisman` — sohbet + canlı göstergeler
- OpenAI anahtarı: `/admin/sistem` (süper admin) → `platform_settings.openai_api_key`
- Anahtar yoksa: kural-tabanlı **yedek kip** (sistem yine çalışır)
- Öncelik: DB anahtarı → `OPENAI_API_KEY` env → yedek kip

### 5) Türkçeleştirme (UI)
- Admin: ofis / aday / destek talebi / aylık gelir / müşteri kaybı vb.
- Ofis ayarları: “Aday yakalama” (eski Lead metinleri)
- Kod/rota/tablo adları bilinçli olarak bırakıldı

### 6) Diğer önemli özellikler (önceki turlar)
- Geo (81 il / ilçe / mahalle), Endeksa + Tapusor iskeleti
- Destek talepleri, abonelik/fatura iskeleti, iyzico
- Görevler, randevu/cron, portal, vitrin, değerleme
- Premium marketing ana sayfa

---

## Önemli dosyalar

| Konu | Dosya |
|------|--------|
| Platform erişim | `src/lib/platform-access.ts`, `src/lib/platform.ts` |
| Bildirim | `src/lib/platform-notify.ts`, `src/components/admin/notification-bell.tsx` |
| Satış / dönüşüm | `src/app/actions/platform-sales.ts`, `src/app/admin/satis/` |
| Yapay zeka | `src/lib/ai-advisor.ts`, `src/app/actions/ai-advisor.ts`, `src/app/admin/danisman/` |
| Anahtar ayarı | `src/lib/platform-settings.ts`, `src/components/admin/openai-key-form.tsx` |
| Admin kabuk | `src/components/admin/admin-sidebar.tsx`, `admin-topbar.tsx`, `command-palette.tsx` |

---

## Çalıştırma

```bash
cd C:\Users\volka\Projects\emlaksoft
npm run dev
npm run build
```

Ortam: `.env.local` (Supabase, iyzico, isteğe bağlı `OPENAI_API_KEY`, `CRON_SECRET`, VAPID, Endeksa/Tapusor)

---

## Sıradaki yüksek değerli adaylar

1. ~~**Türkçeleştirme tarama tamamı**~~ — ✅ tamamlandı (23 Temmuz)
2. ~~**Toplu duyuru**~~ — ✅ tamamlandı (23 Temmuz)
3. ~~**iyzico canlı tahsilat**~~ — ✅ webhook + callback akışı eksiksiz doğrulandı
4. ~~**Endeksa / Tapusor canlı anahtar**~~ — ✅ DB'den anahtar yönetim UI + `*Full()` async config
5. ~~**Personel yönetimi UI**~~ — ✅ tamamlandı (23 Temmuz)
6. ~~**Danışman sohbet geçmişi**~~ — ✅ migration 026 + oturum/mesaj DB kaydı + sidebar UI

Sıradaki adaylar:
- **iyzico webhook test** — sandbox'ta gerçek ödeme senaryosu doğrulaması (canlı anahtarlarla)
- **Endeksa / Tapusor gerçek API testi** — prod anahtarlarla `/app/degerleme` uçtan uca test
- **Danışman sohbet PDF export** — TXT'den daha zengin format istenirse (isteğe bağlı)
- **platform_audit_logs temizleme cron'u** — 90 gün+ eski kayıtları sil (isteğe bağlı)

---

## Tasarım kuralları (hatırlatma)

- Koyu arka plan üstüne koyu yazı yok; kontrast yüksek, premium
- Admin koyu kabuk (amber vurgu); ofis paneli marka dilinde
- Landing: marka önce, tek kompozisyon, gereksiz kart yok
- “Premium plus / ultra kurumsal” — HGDekor derinliği, eksiksiz özellik hedefi

---

## Bilinçli bırakılanlar

- DB kolon/tablo adları: `tenants`, `demo_requests`, `support_tickets` …
- URL’ler: `/admin/tenants`, `/app/ayarlar/lead`, `/api/leads/...`
- Fonksiyon adları: `convertDemoToTenant`, `requirePlatformModule("tenants")`
- Ürün markaları UI’da kalabilir: OpenAI, iyzico, Endeksa, Tapusor (entegrasyon adı)

---

*Bu dosyayı güncelleyerek devam et; her büyük özellik bitince buraya 3–5 satır ekle.*
