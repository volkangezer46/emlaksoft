# EmlakSoft — Devir & Süreklilik Dosyası

> **Son güncelleme:** 24 Temmuz 2026  
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
- `000033` — `tenants.iban`, `phone`, `address_line`, `city` ✅ production'a uygulandı
- `000034` — `tenants.logo_url`, `website` ✅ production'a uygulandı
- `000035` — `customers.birth_date`, `anniversary_date` (index'li) ✅ production'a uygulandı
- `000036` — hot-path composite index'ler (assigned_to, status vb.) ⚠️ **production'a uygulanacak**
- `000037` — `rate_limits` tablosu + `check_rate_limit` RPC (public endpoint koruması) ✅ production'a uygulandı
- `000038` — `campaign_channel` enum'a `email` eklendi ✅ production'a uygulandı
- `000039` — `property_dues` (aidat takibi) ✅ production'a uygulandı

Rehber: `MIGRATION_GUIDE.md`  
Tek dosya uygula: `npx tsx scripts/apply-one.ts supabase/migrations/<dosya>.sql`

---

## Bu sohbette tamamlanan işler

### 26) İnteraktif harita (rakip özelliği) + ana sayfa ultra-premium (24 Temmuz 2026)

**Build: ✓ 0 hata.** Production deploy (`1ee6cd2`, `760e781`).

#### İnteraktif harita üzerinde portföy (sahibinden/Zingat standardı)
- **`PropertyMap`** (`src/components/app/property-map.tsx`) — OpenStreetMap embed: ücretsiz, **API anahtarı/npm dependency gerektirmez**; işaretli interaktif harita, yoksa adres araması
- Portföy detayına "Konum" bölümü (lat/lng varsa harita)
- **`LatLngPicker`** — new/edit form'da enlem/boylam + "Konumumu kullan" (tarayıcı geolocation) + haritadan doğrula linki
- `properties.lat/lng` zaten şemadaydı → create/update action'lara + dialog'lara bağlandı

#### Ana sayfa ultra-premium
- Canlı animasyonlu **aurora mesh** arka planı (`.hero-aurora`, 22s yumuşak drift, reduced-motion desteği)
- Birincil CTA gradient (`grad-brand`) + güçlü glow + ok mikro-animasyonu

#### Rakip özellik durumu (rakip analizinden)
Uygulanmış: lead skorlama, TÜFE kira artış, aidat, TAKBİS, e-posta/sözleşme şablonları, komisyon split, otomatik eşleştirme bildirimi, takvim sync, **interaktif harita**. Harici API/kredi gerektirenler (iskelet mevcut): **WhatsApp Business inbox**, **ilan performans analitiği** (portal metrik API'si), sanal tur/360°.

---

### 25) Bildirim merkezi zenginleştirme (24 Temmuz 2026)

**Build: ✓ 0 hata.** Production deploy (`e590768`).

`src/components/app/notification-bell.tsx`:
- Sayılı okunmamış rozeti (9+) + "X yeni" etiketi
- **Tümü / Okunmamış** sekmeleri
- Tür-renkli ikonlar (success/warning/danger/system/info)
- **Zaman gruplama** (Bugün / Bu hafta / Daha eski) + göreli zaman ("5 dk önce")
- İkonlu premium boş durum, okunmamış nokta göstergesi

- **Admin bildirim merkezi** de aynı zenginleştirmeyle güncellendi (`b8032b3`) — app ile tutarlı; "Tüm bildirimleri gör" footer linki korundu

---

### 24) Premium boş-durum (EmptyState) sistemi (24 Temmuz 2026)

**Build: ✓ 0 hata.** Production deploy (`af61914`).

- **`src/components/app/empty-state.tsx`** — yeniden kullanılabilir premium boş durum: gradient orb + ikon tile + ton varyantları (brand/mint/amber/danger) + opsiyonel CTA (href veya node)
- **9 sayfaya tutarlı uygulama**: aidat, teklifler, kampanyalar, giderler, sözleşmeler, randevular, görevler, açık ev, portallar
- Çift-border yok deseni: boşken bordersız `EmptyState`, doluyken bordered liste/tablo (ternary section'ın dışına taşındı)

---

### 23) Profesyonel katman — SEO, hata sayfaları, a11y (24 Temmuz 2026)

**Build: ✓ 0 hata.** Production deploy (`44f2f10`, `1934299`).

#### SEO / sosyal paylaşım
- Zengin `metadata`: Open Graph, Twitter card, keywords, robots (googleBot max-preview), formatDetection, canonical, category
- **Dinamik markalı Open Graph görseli** — `src/app/opengraph-image.tsx` (`next/og` ImageResponse, 1200×630, gradient + rozetler)
- **Landing JSON-LD** yapılandırılmış veri (Organization + SoftwareApplication schema)
- demo/kayıt/giriş sayfalarına SEO başlık + description + canonical (giriş noindex)

#### Hata sayfaları (markalı)
- **`not-found.tsx`** — premium 404 (gradient hero, hızlı bağlantılar)
- **`global-error.tsx`** — root layout hatalarını yakalayan kendi html/body'li fallback

#### Erişilebilirlik (a11y)
- Site geneli `:focus-visible` görünür odak halkası (koyu bölümlerde cyan kontrast)
- **"İçeriğe atla"** skip-link (Tab ile görünür) → landing/app/admin `#main-content`

---

### 22) Lead skoru (liste) + komisyon split editörü (24 Temmuz 2026)

**Build: ✓ 0 hata.** Production deploy (`514f197`, `ba4859c`).

- **Müşteri listesinde lead skoru** — `customer_lead_signals` aggregate RPC (migration 041): müşteri başına aktif talep/iletişim/randevu/çağrı + son etkileşim tek sorguda. Her satırda 🔥Sıcak/🌤️Ilık/❄️Soğuk rozet + **"Sıcak önce"** sıralama toggle'ı (sıcak aday sayısıyla). Danışman en sıcak adaylara öncelik verir
- **Komisyon çok-taraflı paylaşım editörü** — `updateCommissionSplits` action (oran→tutar otomatik, %100 doğrulaması) + `CommissionSplitEditor` (taraf ekle/çıkar, canlı tutar/kalan%). Komisyon satırında mevcut paylaşım gösterimi. "Çok taraflı paylaşım" vaadi artık uçtan uca

#### Migration (production ✅)
- `041` customer_lead_signals RPC

---

### 21) 3 yeni detay sayfası — paneldeki tüm kayıtlar artık açılabilir (24 Temmuz 2026)

**Build: ✓ 0 hata.** Production deploy (`90fe5ac`).

Doğal hedefi olmadığı için önceki turda atlanan kayıtlara **kendi detay sayfaları** eklendi:
- **Ekip üyesi (danışman) detay** `/app/ekip/[id]` — profil, atanmış müşteri + portföy listesi, bu ay komisyon, randevu/çağrı istatistikleri. Bağlandı: ekip listesi adı + **danışman-kpi liderlik satırı** + **hedef kartları** (per-advisor)
- **Admin satış/lead detay** `/admin/satis/[id]` — iletişim bilgileri, talep mesajı, mevcut `DemoCard` aksiyonları (durum/atama/not/dönüştür), dönüştürülen ofis linki. Bağlandı: demo kartı adı
- **Otomasyon kuralı detay** `/app/otomasyonlar/[id]` — tetikleyici + config, koşullar, aksiyonlar, çalışma geçmişi. Bağlandı: otomasyon satırları

Böylece paneldeki **pratikte tüm kayıtlar** tıklanınca ilgili detaya açılıyor (müşteri, portföy, sözleşme, teklif, talep, randevu, komisyon, anlaşma, destek, görev, açık ev, çağrı, İYS izni, kayıp-kaçak, abonelik/fatura, ekip üyesi, lead, otomasyon).

---

### 20) Tüm panel kayıtları tıklanabilir + ekip sorgu optimizasyonu (24 Temmuz 2026)

**Build: ✓ 0 hata.** Production deploy (`1205226`).

#### Tıklanabilirlik tamamlandı (stretched-link → ilgili kayıt)
Bu turdan önce zaten tıklanabilir: müşteri/portföy/sözleşme/teklif/talep/randevu/komisyon/anlaşma/destek. Eklenen:
- **Görevler** → müşteri/portföy, **Açık Ev** → portföy, **Arama (çağrı)** → müşteri
- **Uyum (İYS consent)** → müşteri, **Kayıp-kaçak** → portföy
- **Admin Billing** (abonelik + fatura satırları) → tenant detay
- Doğal hedefi/detayı olmayanlar bilinçli atlandı: otomasyonlar, hedefler, danışman-kpi, admin members/personel, satış demo kartı (detay sayfası yok)

#### Performans
- **Ekip**: her yüklemede 10.000 müşteri satırı çekip danışman başına sayıyordu → **`customer_counts_by_advisor` aggregate RPC** (migration 040) ile ~N danışman satırı
- Lead source stats unbounded → limit'li

#### Migration (production ✅)
- `040` customer_counts_by_advisor RPC

---

### 19) Sistem geneli max hız optimizasyonu (24 Temmuz 2026)

**Build: ✓ 0 hata.** 2 keşif ajanı (waterfall tarama) + auth hot-path analizi → uygulandı → production deploy (`3252b44`).

#### Auth hot-path dedup (en yüksek etki — her sayfa + her action)
- **`getRequestUser`** (`lib/supabase/auth-cache.ts`, React `cache()`) — `supabase.auth.getUser()` her çağrıda Supabase Auth sunucusuna gidip JWT doğruluyordu; request başına 2-3× çağrılıyordu → **1×**. `require-module-page`, `require-permission`, `tenant-guard`, app layout hepsi bunu kullanıyor
- **`getPlatformStaff`** `cache()`'lendi — request içinde platform_staff sorgusu dedupe

#### Ofis skoru dedup
- **`getCachedOfficeScore`** (`lib/office-score.ts`, React `cache()`) — dashboard hem layout hem page'de skoru hesaplıyordu (10 sorgu) → **5** (paylaşımlı). Layout'ta skor + bildirimler paralel; dashboard'da `loadOfficeScoreInputs` ana batch'e katıldı

#### Waterfall paralelleştirme (~13 round-trip tasarrufu)
- paylas/[token] (3→1), vitrin/[slug] (4→3), vitrin/[slug]/[id] (4→2)
- customer-portal + owner-portal: `last_seen` update batch'e fold
- destek/[id] + admin/tickets/[id]: ticket + messages paralel
- ayarlar/lead, lead/[token]: bağımsız sorgular paralel; workflow deal-won: update+log+notify paralel
- Lead kaynak istatistiği unbounded → limit'li

> Not: `core.autocrlf=true` nedeniyle çalışma ağacında ~166 dosya satır-sonu farkı gösterebilir (içerik diff'i yok); commit'lere yalnızca gerçek değişen dosyalar dahil edildi.

---

### 18) "Hepsini sırayla yap" — 4 dalga özellik + bug fix turu (24 Temmuz 2026)

**Build: ✓ 0 hata.** Rakip analizi + denetim bulgularının tamamı dalgalar halinde uygulandı, her dalga sonu commit + production deploy.

#### DALGA 1 — Tıklanabilirlik + kritik bug
- **Talepler / Randevular / Komisyon / Anlaşmalar** kartları stretched-link ile ilgili kayda (müşteri/portföy) tıklanabilir (Kampanyalar doğal hedefi olmadığı için atlandı)
- **🐛 BUG: `customer-portal.ts` tamamen bozuktu** — `demands`/`matches`/`demand_type`/`provinces` gerçek şemayla eşleşmiyordu (müşteri portalı çalışmıyordu). `customer_demands` + `budget_min/max` + `geo_provinces`'e çevrildi; **matches tablosu yok** → aktif taleplere göre portföyler `scoreDemandProperty` ile anlık skorlanıyor

#### DALGA 2 — Zeka katmanı
- **Otomatik eşleştirme bildirimi** (`lib/match-notify`) — yeni portföy eklenince aktif taleplerle skorlanır, güçlü eşleşme (≥60) varsa danışmana ofis-içi bildirim + web push (`createProperty`'ye bağlandı)
- **Lead skorlama** (`lib/lead-score`) — müşteri 360 sinyallerinden (telefon/e-posta/kaynak/talep/iletişim/randevu/güncellik) 0-100 skor + 🔥 Sıcak / 🌤️ Ilık / ❄️ Soğuk rozet, müşteri detay hero'da

#### DALGA 3 — Entegrasyon & şablonlar
- **TAKBİS/Tapusor ada-parsel sorgu paneli** — portföy detayında; `queryTapuInsight` action (DB-aware config); anahtar yoksa zarif kurulum yönlendirmesi. `getTapusorParcelInsight` DB anahtarını da destekler hale geldi
- **Kampanya şablon kütüphanesi** (`lib/campaign-templates`, 7 hazır şablon) + **e-posta kanalı** (enum migration 038; sağlayıcı yapılandırılınca aktif)
- **Sözleşme şablon kütüphanesi genişletildi** — teklif mektubu + hizmet/aracılık sözleşmesi (KVKK + TÜFE maddeli)

#### DALGA 4 — Modüller & harita
- **Yeni modül: Aidat & ortak gider takibi** `/app/aidat` — `property_dues` tablosu (migration 039), portföy bazlı aidat, ödendi/bekliyor/gecikti durumu, özet kartları, sidebar'a eklendi
- **Harita**: portföy adresi → Google Maps "Haritada göster" linki (hafif)
- **Takvim .ics + Google/Outlook senkronizasyonu** zaten tam implement edilmiş (`lib/calendar`, `addToGoogleCalendar` two-way dahil) — doğrulandı

#### Deploy'da uygulanan migration'lar (production ✅)
- `038` campaign_email_channel · `039` property_dues

#### ⚠️ Kalan (harici bağımlılık / daha büyük — bilinçli ertelendi, dokümante)
- **Portal görüntülenme/lead metrikleri** — gerçek portal (sahibinden/hepsiemlak) kurumsal API'si gerektirir. Mevcut portallar sayfası teyit sağlığı + portal başına kırılımı zaten gösteriyor
- **Tam interaktif harita (pin/ısı haritası)** — `properties`'e `latitude/longitude` kolonu + adres geocoding servisi gerekir (harici). Şu an Google Maps linki mevcut
- **Komisyon split editörü** — `commissions.splits` jsonb altyapısı var; görsel editör niş olduğu için ertelendi
- **Gerçek WhatsApp Business API + inbox** — iskelet mevcut, kurumsal API gerekir

---

### 17) Tıklanabilirlik + full responsive + yeni modüller + CANLIYA ALINDI (24 Temmuz 2026)

**Build: ✓ 0 hata.** 3 paralel keşif ajanı (tıklanabilirlik / responsive / rakip analizi) → bulgular uygulandı → **production'a deploy edildi.**

#### 🚀 Canlıya alma
- `git push origin main` → Vercel otomatik production deploy tetiklendi (commit `073b3c2`)
- Migration **036** (hotpath indexes) + **037** (rate_limits + check_rate_limit RPC) production DB'ye **uygulandı** ✅

#### Tıklanabilir kayıtlar (stretched-link deseni, ekstra JS yok)
- Müşteriler / Sözleşmeler / Teklifler tablo satırları artık **tamamen tıklanabilir** → detay
- Admin ofis listesinden ofis adı → `/admin/tenants/[id]` detayına link (önceden hiç link yoktu)

#### Yeni modüller
- **Teklifler detay sayfası** `/app/teklifler/[id]` — durum aksiyonları (kabul/ret/karşı teklif/geri çek), ilişkili portföy+müşteri linkleri, zaman çizelgesi, liste fiyatına göre % fark. `getOffer` action + `OfferStatusActions`
- **TÜFE Kira Artış Hesaplama** `/app/kira-artis` — 12 aylık ortalama TÜFE yasal tavanı (TBK m.344) otomatik uygular; yeni kira + aylık/yıllık fark; manuel oran + tavan kontrolü. `src/lib/tufe.ts` (TÜİK referans serisi 2024-2025, yeni ay verisi eklenebilir). Sidebar'a eklendi (valuation modülü)

#### Full responsive
- **4 modal** (teklif/sözleşme/kampanya/anlaşma) → mobil dikey scroll deseni (`items-start + overflow-y-auto + sm:items-center + my-auto`)
- Komisyon hero grid `grid-cols-3` → `grid-cols-1 sm:grid-cols-3` (mobilde veri kesilmesi giderildi)
- Bildirim menüleri (app+admin) → `w-[min(340px,calc(100vw-1.5rem))]` (dar ekranda taşma yok)
- `globals.css` body'ye güvenlik amaçlı `overflow-x: hidden`
- Denetim sonucu: 10 tablonun tamamı zaten `overflow-x-auto` ile responsive ✅

#### Rakip analizi notları (gelecek turlar için, DEVIR'de saklı)
Yüksek değerli sıradaki adaylar: gerçek WhatsApp Business API + inbox, harita üzerinde portföy (lat/lng), otomatik eşleştirme bildirimi (altyapı hazır — hızlı kazanım), lead skorlama, e-posta kanalı + kampanya şablonları, sözleşme merge-field şablon kütüphanesi, TAKBİS tapu sorgu UI, ilan performans analitiği, takvim senkronizasyonu (.ics).

---

### 16) Kalan maddelerin kapatılması + derin performans turu (24 Temmuz 2026)

**Build: ✓ 0 hata.** Sprint-15'te "bilinçli ertelendi" denen tüm maddeler kapatıldı + sistem geneli performans.

#### 🐛 Kritik gizli bug'lar bulundu & düzeltildi
- **Portal yayınlama tamamen bozuktu** — `portal-publish.ts` `province:provinces(name)` / `district:districts(name)` kullanıyordu ama gerçek FK tabloları `geo_provinces`/`geo_districts`. PostgREST embedded join başarısız → `property` hep null → her yayın "Portföy bulunamadı" veriyordu. Düzeltildi (owner-portal.ts'te de aynı bug vardı, düzeltildi)
- **`sendBulkSms` XML iç içe `<no>`** — `<no>${nos}</no>` sarmalaması `<no><no>..</no></no>` üretiyordu (Netgsm şemasına aykırı). Dış sarmalayıcı kaldırıldı + usercode/password/msgheader XML-escape edildi
- **`updateTeamMember` ölü kod** — kendini kilitleme koruması boş `if` bloğundaydı; artık kendi yönetici rolünü düşürme + kendini pasife alma engelleniyor

#### Portal entegrasyonu tamamlandı (4/4 portal)
- Spec-tabanlı tek adaptör motoru (`PORTAL_SPECS`) — sahibinden/hepsiemlak/**zingat**/**emlakjet** artık publish/update/unpublish destekliyor
- `updateOnPortal` (PUT) + `updatePropertyOnPortal` action — fiyat/başlık değişince canlı ilanı senkron
- `mapToZingat` + `mapToEmlakjet` alan eşlemeleri, `SUPPORTED_PORTALS` + `isPortalSupported`
- `getConfiguredPortals` artık yalnız adaptörü OLAN portalları döner (UI tutarlılığı — kullanıcı desteklenmeyen portala anahtar girip hata almaz)

#### Güvenlik sertleştirme (public/auth'suz yüzey)
- **DB-tabanlı hız sınırlayıcı** — migration 037 `rate_limits` tablosu + atomik `check_rate_limit` RPC + `src/lib/rate-limit.ts` (fail-open)
- Demo formu: IP başına 10 dk'da 5 talep + **honeypot** alanı (bot koruması)
- Public imza gönderimi: IP başına dakikada 10 deneme (token enumeration koruması)
- `next.config`: **HSTS** (2 yıl, preload) + **Permissions-Policy** başlıkları

#### Derin performans (dünya-standardı hedefi)
- **Proxy middleware matcher daraltıldı** ⭐ — eskiden TÜM isteklerde (marketing, vitrin, token, public) `getUser()` ağ çağrısı yapıyordu; artık yalnız `/app`, `/admin`, `/giris`, `/kayit`. Public trafikte her sayfa yükünden bir Supabase Auth round-trip kalktı (en büyük kazanç)
- **Kalan Tier-2 waterfall'lar** paralelleştirildi: `ayarlar/roller` (2→1), `musteriler/[id]` (customer batch'e katıldı, 12 sorgu tek turda), `admin/tenants/[id]` (tenant batch'e katıldı)

#### ⚠️ Bilinen kalan iş (dokümante edildi, riskli olduğu için ertelendi)
- **`customer-portal.ts` şema uyumsuzluğu** — `admin.from("demands")` (tablo `customer_demands`), `demand_type` kolonu (gerçekte `transaction_type`/`property_type`), `matches` tablosu, `provinces` — bu fonksiyon eski/farklı şemaya göre yazılmış ve uçtan uca test edilmemiş görünüyor. Kör yeniden adlandırma yeni bug riski taşıdığından, ayrı bir düzeltme turunda şema eşlemesi doğrulanarak ele alınmalı
- WhatsApp gönderimi: yapılandırılabilir (API url/token set edilirse çalışır) — bilinçli iskelet

#### Deploy'da uygulanacak migration'lar
```
npx tsx scripts/apply-one.ts supabase/migrations/20260724000036_hotpath_indexes.sql
npx tsx scripts/apply-one.ts supabase/migrations/20260724000037_rate_limits.sql
```

---

### 15) 360° kalite + dünya-standardı performans turu (24 Temmuz 2026)

**Build: ✓ 0 hata, 43 dinamik route** — 2 paralel keşif ajanı (waterfall + kalite denetimi) çalıştırıldı, bulgular uygulandı.

#### 🔴 KRİTİK güvenlik açığı kapatıldı
- **`updateTenantInfo` yetki kontrolü yoktu** (`src/app/actions/settings.ts`) — herhangi bir tenant kullanıcısı (readonly/advisor dahil) ofis adı, **vergi no, IBAN**, marka rengini doğrudan çağırarak değiştirebiliyordu (RLS'e güveniliyordu). Artık `requirePermission("settings","edit")` (owner/gm) + `logActivity` kaydı. Sözlük: settings.edit advisor'da yalnız VIEW.

#### Yeni premium özellikler
- **Müşteri doğum tarihi + yıldönümü alanları** — new/edit dialog + `createCustomer`/`updateCustomer` action (`isValidOptionalDate` takvim doğrulaması), müşteri 360 select'e eklendi (migration 035 kolonları kullanıldı)
- **Yaklaşan özel günler banner'ı** — `/app/musteriler` üstünde önümüzdeki 7 gün içindeki doğum günü 🎂 / yıldönümü 🎉; ekstra sorgu yok (mevcut listeden hesaplanır), müşteri detayına link
- **Raporlar gelir/gider karşılaştırma grafiği** — son 6 ay komisyon (gelir) vs `expenses` (gider) gruplanmış bar chart + toplam gelir/gider/net kartları; veri yoksa empty state
- **Admin tenant abonelik değiştirme paneli** — `subscription-panel.tsx` (paket + durum dialog), mevcut `updateTenantPlanStatus` action'ına bağlandı, tenant + subscriptions senkron güncelleme
- **Sözleşme e-imza akışı TAMAMLANDI** — eksik olan public `/imza/[token]` imza sayfası oluşturuldu (sözleşme metni + imzalayanlar durumu + onay + IP kaydı); `sendContractForSigning` artık token'ları geri okuyup **Netgsm SMS ile imza linki gönderiyor** (yapılandırılmışsa); `submitSignatureByToken` form action

#### Performans (dünya-standardı hedefi)
- **Waterfall paralelleştirme** (ardışık bağımsız DB round-trip → tek `Promise.all`):
  - `admin/sistem` — 3 batch → 1 (10 sorgu tek turda)
  - `app/franchise` — `loadOfficeScoreInputs` + 7 sorgu tek batch
  - `app/portfoyler/[id]` — 4 tur → 2 (property+portals+history+configured tek turda, sonra notFound)
  - `app/degerleme` — 2 batch → 1 (endeksa/tapusor config sorguya katıldı)
  - `admin/aktivite` — 2 isim çözümleme sorgusu → 1
- **Unbounded query koruması** — `danisman-kpi` (5×5000), `ekip` (customers 10000), `admin/page` (tenants 2000, subs 5000)
- **Hot-path index migration** `20260724000036_hotpath_indexes.sql` — customers/properties `(tenant_id, assigned_to)`, subscriptions `(tenant_id, status)`, demo_requests, valuations, offers `(created_by, status)`

#### Tutarlılık & a11y (kalite denetimi bulguları)
- **6 eksik admin `loading.tsx`** eklendi: bildirimler, danisman, duyuru, geo, members, sistem
- **a11y** — `branch-card.tsx` X butonu `aria-label="Vazgeç"`; `site-header.tsx` mobil menü toggle `aria-label` (state'e göre) + `aria-expanded`
- **Portal veri kaybı** — `mapToSahibinden`/`mapToHepsiemlak` artık `floorCount` + `buildingAge` maplıyor (sessiz veri kaybı giderildi)

#### ⚠️ Deploy'da uygulanacak
- **Migration 036** production'a uygulanmalı: `npx tsx scripts/apply-one.ts supabase/migrations/20260724000036_hotpath_indexes.sql`
- SMS imza bildirimi için Netgsm anahtarı gerekli (yoksa link üretilir ama SMS atılmaz — akış yine çalışır)

#### Kalite denetiminden kalan düşük öncelikli notlar (bilinçli/ertelendi)
- Portal `zingat`/`emlakjet` adaptörleri hâlâ iskelet (UI anahtar girmeye izin veriyor); `updateListing()` implement edilmedi
- WhatsApp gönderimi iskelet (API url/token set edilirse çalışır)
- `demo.ts` / token portal endpoint'lerinde rate-limit yok (spam yüzeyi)
- `sendBulkSms` XML `<no>` iç içe sarma riski — Netgsm şemasıyla doğrulanmalı

---

### 14) Rakip analizi + büyük özellik turu (24 Temmuz 2026)

**Build: ✓ 0 hata, 70 sayfa**

#### Tamamlanan özellikler
- **Otomasyonlar** — `applyAutomationTemplate`, `toggleAutomation`, `deleteAutomation` server action'ları. "Uygula" butonu artık şablonu DB'ye kaydeder, toggle/sil çalışır
- **Logo upload** — `tenants.logo_url + website` migration (034), `uploadTenantLogo` action, `LogoUploadForm` client component, ayarlar sayfasına entegre
- **Teklifler** — `NewOfferDialog` — portföy auto-fill, müşteri seçimi, geçerlilik tarihi. Teklifler sayfasına "Yeni teklif" butonu eklendi
- **Sözleşme detay** — `/app/sozlesmeler/[id]` yeni sayfası + `ContractSignPanel` (imzalayan ekle → imzaya gönder)
- **Benzer portföy widget** — portföy detay sayfasına `RelatedPropertiesWidget` eklendi (skor tabanlı: aynı tip+il)
- **Müşteri gelişmiş filtre** — kaynak, tip, danışman, tarih aralığı filtreleri; server-side uygulama
- **Toplu portal yayınlama** — `PublishToPortalsPanel`'e "Tümüne yayınla" butonu eklendi
- **Doğum günü/yıldönümü cron** — migration 035 (`birth_date`, `anniversary_date`), `/api/cron/dogum-gunu` endpoint, vercel.json'a eklendi (08:00 TR saati)
- **IBAN + adres + telefon + website** — migrations 033-034, settings action + form güncellendi
- **Admin topbar arama** — `max-w-lg w-full`, flex-1 ile tam genişlik
- **Font optimizasyonu** — latin-ext kaldırıldı, Geist Mono preload: false, build süresi ~11s

#### Yeni migrations
- `20260724000033_tenant_iban.sql` — iban, phone, address_line, city
- `20260724000034_tenant_logo.sql` — logo_url, website
- `20260724000035_customer_dates.sql` — birth_date, anniversary_date (index'li)

#### Yeni cron endpoint
- `/api/cron/dogum-gunu` — her gün 08:00, bugün doğum günü/yıldönümü olan müşteriler için ofise bildirim

#### Sıradaki vizyon adımları
- Dashboard son 24s aktivite feed (D)
- Randevular takvim görünümü (F)
- Müşteri edit dialog'una doğum tarihi alanı ekle
- Müşteri sayfasında yaklaşan doğum günü banner'ı
- Raporlar → gelir/gider karşılaştırma grafiği
- Admin tenant detay — abonelik değiştirme butonu

---

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
