# Coğrafya envanteri (ADIM 0) ve tek merkez haritası

Güncelleme: bu görev (coğrafya tek merkez). Kural: **il/ilçe/mahalle verisi YALNIZ `src/lib/geo/**` üzerinden gelir.**
Sözleşme testi: `src/lib/geo/geo-central-contract.test.ts` (doğrudan `from("geo_*")` yalnız `src/lib/geo/**`; sabit il listesi yok;
yeni serbest metin il/ilçe `<input>` yok).

## 1. Tablolar ve veri kapsamı

| Tablo | Tanımlandığı yer | Notlar |
| --- | --- | --- |
| `geo_provinces` | `20260721000000_init.sql` (+ `…0017_geo_full_coverage`: population, region) | `plate_code` unique, `name` unique, lat/lng, `is_active` |
| `geo_districts` | aynı + `source_id`, `population` (unique `source_id`) | unique `(province_id, name)` |
| `geo_neighborhoods` | aynı + `source_id`, `postal_code`, `population` | unique `(district_id, name)` |
| `geo_province_stats`, `geo_district_stats` | `…0018_geo_stats_views` | admin sayımları (görünüm) |
| `geo_sync_jobs` + RPC'ler | `20260811000010_geo_province_sync_jobs` | il bazlı TurkiyeAPI tarama kuyruğu (cron `geo-province-sync`) |
| `geo_consistency_check()` | `…0102_geo_consistency` | orphan FK denetimi |

RLS: üçü de herkese okunur (`using (true)`), yazma yalnız `service_role` (`…0017` grant).
Veri kapsamı (kod yorumları / runbook'a göre canlı): 81 il, 973 ilçe, ≈31.9 bin mahalle. Kaynak: **TurkiyeAPI** (`geo:sync` toplu betik,
sonra il bazlı tarama çalışanı). Seed: `scripts/geo-sync.ts` (`npm run geo:sync`), `20260721000001_geo_seed.sql` (pilot il/ilçeler).
Güncel kaynak (2025 veri seti, 2026-05-21): 81 il, 973 ilçe, 32.279 mahalle (bkz. `DATA_SOURCES.md`).

Bu görevin eklediği TASLAK şema: `supabase/proposed/20260820000100_geo_central_management.sql` (UYGULANMADI):
`geo_data_versions`, `geo_aliases`, `geo_change_requests`, ek sütunlar (`description`, `deactivated_at`, `source`, `version_id`),
`demo_requests.province_id/district_id`, RPC'ler `geo_usage_counts/_totals/_rows`, `geo_merge`, `geo_merge_undo`, `geo_move`.
Tablolar yokken her şey bugünkü gibi çalışır (okuyucular yalnız mevcut sütunları seçer; yönetim ekranları "etkin değil" der).

## 2. Okuyan/yazan kod — durum

Merkez (`src/lib/geo/`): `reader.ts` (önbellekli okuyucular, `validateGeoChain`, `searchDistricts`, `searchGeoIds`, ad/kimlik haritaları),
`resolve.ts` (`resolveGeo`, `resolveChainForSave`, `resolveOfficeGeo`), `match.ts`/`normalize.ts`/`validate.ts` (saf çekirdek),
`admin-store.ts` (yönetim yazımı/sayım/sürüm), `import-plan.ts` + `import-apply.ts` (içe aktarma), `backfill.ts` (serbest metin eşleştirme),
`cache.ts` (`invalidateGeoCache` = `updateTag`).

### Merkeze TAŞINAN tüketiciler (doğrudan `from("geo_*")` kaldırıldı)

| Dosya | Eski | Yeni |
| --- | --- | --- |
| `src/lib/geo.ts` (silindi) | `getProvincesCached/getDistrictsCached` | `reader.getProvinceOptions/getDistrictOptions` |
| `src/app/actions/geo.ts` | listDistricts/listNeighborhoods/searchDistricts (GeoSelect veri ucu) | reader'a delege |
| `src/app/actions/geo-admin.ts` | il/ilçe/mahalle CRUD + silme | `admin-store`; SİLME KALDIRILDI (pasife alma/taşıma/birleştirme) |
| `src/app/actions/demands.ts` + `src/lib/demand-geo.ts` | `validateGeoChain(supabase, …)` | `reader.validateGeoChain` |
| `src/app/actions/platform-tenants.ts` | `resolveGeo` (il/ilçe doğrulama) | `getProvince/getDistrict` |
| `src/app/actions/properties.ts` | `resolveGeoHint` | `getDistrictName/getProvinceName` |
| `src/app/actions/valuations.ts` | ilçe/il adı | `getDistrict/getProvinceName` |
| `src/app/actions/public-valuation.ts` | `listPublicDistricts`, ilçe+il gömme | `getDistrictOptions`, `districtWithProvinceResult` |
| `src/app/actions/vitrin.ts` | il/ilçe doğrulama | `getProvince/getDistrict` |
| `src/app/actions/settings.ts`, `onboarding-setup.ts` | serbest metin `city` | GeoSelect + `resolveOfficeGeo` (kimlik + ad birlikte) |
| `src/app/app/degerleme/page.tsx`, `portfoyler/page.tsx` (arama), `raporlar/talep-arz/page.tsx`, `talepler/demands-view.tsx` | ilçe/il adı, arama | `getDistrictNameMap`, `searchGeoIds`, `getProvinces`, `getProvince` |
| `src/lib/comparables.ts`, `src/lib/sample-data-seed.ts` | ilçe adı, İstanbul ilçeleri | `getDistrictName`, `resolveGeo` |
| `src/lib/geo-province-sync.ts` | plaka okuma | `getProvince` |
| `src/app/admin/sistem/system-view.tsx` | sayımlar | `geoRowCount` |
| `src/app/admin/geo/**` (gezgin) | doğrudan tablo | `admin-store` |
| İl listesi çeken sayfalar: `app/ekip`, `ekip/subeler`, `musteriler/yeni`, `musteriler/[id]`, `musteriler/[id]/talep/yeni`, `portfoyler/[id]`, `portfoyler/yeni`, `talepler/yeni`, `talepler/[id]`, `degerleme`, `ag`, `lead/[token]`, `vitrin/[slug]`, `vitrin/[slug]/[id]`, `vitrin/[slug]/degerleme`, `admin/tenants/yeni`, `lib/admin/office-management.ts` | `from("geo_provinces").select("id, name")` | `getProvinceOptions` / `provinceOptionsResult` (yeni kayıt: yalnız aktif; mevcut kaydı düzenleyen `[id]` sayfaları `includeInactive`) |

Davranış değişmedi: URL parametreleri, FK'ler, GeoSelect bileşeni (`src/components/app/geo-select.tsx`) aynı; yalnız veri ucu merkez.
Bilinçli fark: pasif kayıt yeni seçimde görünmez (GeoSelect aktif listeyi alır).

### Kalan (kapsam dışı / gömme)

* **PostgREST gömmeleri** (`province:geo_provinces(name)`, `district:geo_districts(name)`): ad gösterimi için FK gömmesi; `from()` değil, sözleşme
  kapsamı dışı. Dosyalar: `ai-content, customer-portal, export, network, owner-portal, portal-publish` actions; `api/cron/portal-teyit`, `api/vitrin-favoriler`;
  `app/_home/data`, `anlasmalar/[id]`, `degerleme/[id]`, `musteriler`, `portfoyler/**`, `danisman/[slug]`, `degerleme-raporu`, `musteri-portali`, `paylas`, `sunum`,
  `vitrin/**`, `lib/export-full.ts`. (İleri iş: ad önbellekli servise bağlama.)
* **scripts/** (CLI, `src/` dışı): `seed-demo.ts`, `geo-sync.ts` (toplu pg upsert), `perf-measure2.ts`, `check-schema.ts`, `action-gate-audit.ts`.
* Sitemap/SEO (`src/app/sitemap*`), ilan havuzu puanı (`src/lib/pool`), danışman bölgeleri (`src/lib/advisor`): bu dalda geo tablolarına doğrudan dokunmuyor
  (danışman bölgeleri `advisor_regions` FK'li; merge/move RPC'leri FK kataloğundan dinamik kapsar).

## 3. Serbest metin il/ilçe alanları

| Alan | Durum |
| --- | --- |
| `tenants.city` — ayarlar `company-form`, kurulum `office-step`, `settings.ts`/`onboarding-setup.ts` | **ÇEVRİLDİ**: GeoSelect; sunucu `resolveOfficeGeo` ile doğrular (geçersiz il reddedilir), `province_id/district_id` + `city` (görünen ad) birlikte yazılır. Eski metin gelirse servisle çözülür, çözülemezse reddedilir |
| Platform ofis oluşturma (`admin/tenants/yeni`) | Zaten GeoSelect + `resolveGeo` (platform-tenants.ts) |
| Eski kimliksiz `tenants.city` kayıtları | `/admin/geo/eslestir`: toplu çözümleme raporu; kesin eşleşmeler toplu, yazım toleranslı olanlar satır onayıyla; belirsizler "eşleşmeyen" |
| `demo_requests.city`, `platform ön satış lead city` (`admin/satis/lead-panel`) | İSTİSNA (ön satış potansiyel müşteri metni); `demo_requests.province_id/district_id` taslakta |
| Ödeme alıcısı şehri (`odeme-link/[token]/pay-buttons`, `billing.ts`, `lib/billing/buyer.ts`) | İSTİSNA: sağlayıcıya serbest adres gider; ödeme akışı bu görev dışı |
| `register-form` (kayıt), `/demo`, şube kayıtları (`branches.province_id` zaten FK + GeoSelect), danışman kimlik/adres | Kayıt formunda il/ilçe alanı yok; şubeler FK'li; danışman adresi yok |
| İçe aktarma (müşteri/portföy CSV) | Bu dalda geo alanı okuyan içe aktarma yok; yeni içe aktarmalar `resolveGeo` + "eşleşmeyen" raporu kullanmalı |

## 4. Hazır araçlar (yeni kod için)

`import { getProvinceOptions, getDistrictOptions, validateGeoChain, searchGeoIds } from "@/lib/geo/reader"`,
`import { resolveGeo, resolveChainForSave, resolveOfficeGeo } from "@/lib/geo/resolve"`,
`import { geoKey, geoSlug } from "@/lib/geo/normalize"` (istemcide de güvenli), tipler `@/lib/geo/types`.
Cache tazeleme: yalnız action içinde `invalidateGeoCache()` (`updateTag("geo")`).
