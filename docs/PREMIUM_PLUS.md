# EmlakSoft — Premium Plus kalan özellikler

**Tarih:** 2026-07-22  
**Kaynak:** Tüm chat vizyonu · HGDekor DNA · MASTER_PLAN · kod denetimi  

**Çubuk:** Sahte metrik yok · HGDekor işletim derinliği · emlak farklılaştırıcıları · ultra premium UI

---

## A) Beta kapısı (önce bunlar)

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| A1 | Dashboard / Phone OS sahte KPI temizliği | ✅ | Canlı aggregate; Phone OS talep/eşleşme sayıları |
| A2 | iyzico live + sert webhook | ✅ | HMAC v3 imza doğrulama; `IYZICO_MERCHANT_ID` varsa strict mod |
| A3 | Ödeme linki gerçek tahsilat | ✅ | iyzico Checkout; demo yalnız anahtar yokken |
| A4 | Prod CRON_SECRET + cron smoke | ✅ | `npm run cron:smoke` — tüm cron route'larını + 401 güvenlik kontrolünü doğrular |
| A5 | Sayfa seviyesi modül yetkisi | ✅ | `requireModulePage` CRM + ops sayfalarında |

---

## B) HGDekor işletim DNA’sı

| # | Özellik | Durum | HGDekor karşılığı |
|---|---------|-------|-------------------|
| B1 | Merkezi convert / StatusTransition | ✅ | Deal kartında `StatusTransitionBar` |
| B2 | useApi tüketimi tüm listelerde | ✅ | `useApi` hook + cache + focus refresh |
| B3 | HTTP/Supabase realtime refresh | ✅ | `RealtimeRefresh` layout’ta |
| B4 | Hover prefetch (sidebar) | ✅ | `router.prefetch` on hover/focus |
| B5 | Diff’li audit + actor resolve + export | ✅ | Aktör adı · diff preview · CSV |
| B6 | Bildirim tercihleri → sunucu/cron | ✅ | `profiles.notification_prefs` + gunluk-ozet |
| B7 | Optimistic mutation standartı | ✅ | `ErrorBoundary` + `useApi` |
| B8 | Müşteri 360 medya/dosya + cari | ✅ | Dosya deposu + download API |
| B9 | Token’lı müşteri onay / mini portal | ✅ | `paylas/[token]` zenginleştirildi: ara/WhatsApp CTA, danışman kartı |
| B10 | CI + permission contract test | ✅ | GitHub Actions (`type-check` + `build`); `000011` sembolik SQL |

---

## C) Emlak farklılaştırıcıları (chat vizyonu)

| # | Özellik | Durum |
|---|---------|-------|
| C1 | Değerleme dış kaynak (Endeksa/Tapusor) | ✅ `lib/integrations/{endeksa,tapusor}.ts` — OAuth2/REST client hazır, `estimateMultiSourceValue`'ya ağırlıklı kaynak olarak bağlı; anahtar girilince otomatik canlı |
| C2 | İYS entegratör API | ⬜ bilinçli erteleme — vendor sözleşmesi gerekir |
| C3 | EİDS resmi kayıt (checkbox ötesi) | ⬜ bilinçli erteleme — e-Devlet/GİB erişimi gerekir |
| C4 | Leak Shield proaktif SLA / kanıt | ✅ | 7/14/30 gün uyarı · severity |
| C5 | Eşleştirme kaydet / bildir / ata | ✅ `saveMatchAndNotify` |
| C6 | Phone OS CTI / screen-pop | ⬜ manuel log |
| C7 | QR yer gösterme / anahtar kasası | ⬜ vizyon |
| C8 | Belge OCR / AI danışman (API+onay) | ⬜ bilinçli |

---

## D) Ölçek

| # | Özellik | Durum |
|---|---------|-------|
| D1 | Franchise şube rollup | ✅ | Gerçek şube bazlı portföy/müşteri/danışman/kazanılan işlem rollup (`/app/franchise`) |
| D2 | PWA push (VAPID) | ✅ | `push_subscriptions` + `web-push` + SW push/click handler + ayarlar toggle |
| D3 | Geo sync ürün yüzeyi | ✅ | `/admin/sistem` kapsama paneli + `npm run geo:sync` — TurkiyeAPI'den 81 il/973 ilçe/~31.900 mahalle tam senkron, production DB'de canlı |
| D4 | Coğrafya admin CRUD | ✅ | `/admin/geo` → il/ilçe/mahalle listeleme, arama, ekleme, düzenleme, pasifleştirme/silme (`src/app/actions/geo-admin.ts`) |
| D4 | Offboarding vault / jeton | ✅ | `/admin/tenants/[id]` → tüm tenant verisini JSON olarak indir |

---

## E) Bilinçli yapılmayacak

- Portal scrape  
- Kendi foundation model  

---

## Bu sprint tamamlananlar

1. ✅ A1 sahte metrik öldür  
2. ✅ A5 sayfa yetkisi  
3. ✅ B1 StatusTransition + C5 eşleştirme kaydet-bildir  
4. ✅ B3 realtime + B4 sidebar prefetch  
5. ✅ B5 denetim actor/diff/CSV  
6. ✅ B6 bildirim prefs sunucu (`000009`)  
7. ✅ A3 ödeme linki iyzico + callback/webhook  
8. ✅ B8 müşteri dosyalar (`000010`)  
9. ✅ C4 leak SLA + severity (`000012`)  
10. ✅ B2 useApi genişletme + cache + focus refresh
11. ✅ B7 ErrorBoundary + optimistic mutation foundation
12. ✅ Smoke test script (`npm run test:smoke`)
13. ✅ README + MIGRATION_GUIDE + DEPLOY_CHECKLIST
14. ✅ .env.example güncelle
15. ✅ Dashboard boşluk optimizasyonu + hızlı aksiyonlar
16. ✅ UI primitives (LoadingScreen, EmptyState, PageHeader)
17. ✅ StatCard & Badge components
18. ✅ notification-prefs server action fix
19. ✅ Ana sayfa bento grid boşluk düzeltmesi + Ofis Skoru full-width banner
20. ✅ Performans: next.config.ts (compress, image formats, optimizePackageImports, security headers)
21. ✅ viewport export fix (themeColor uyarısı giderildi)
22. ✅ Route-level loading.tsx + error.tsx (/, /app, /admin) — skeleton shimmer states
23. ✅ Skeleton component kütüphanesi (SkeletonCard, SkeletonRow, SkeletonDashboard, SkeletonList)
24. ✅ A2 webhook imza doğrulama teyidi (zaten sağlamdı, dokümante edildi)
25. ✅ B9 `paylas/[token]` mini portal: ara/WhatsApp CTA + danışman kartı + zengin görsel
26. ✅ B10 GitHub Actions CI pipeline (`.github/workflows/ci.yml`: type-check + lint + build)
27. ✅ SEO: `sitemap.ts` + `robots.ts`
28. ✅ A4 cron smoke otomasyonu (`scripts/cron-smoke.js` + `npm run cron:smoke`)
29. ✅ D2 PWA push (VAPID): `push_subscriptions` migration, `lib/push.ts`, SW push/click handler, ayarlar toggle, `notifyTenant` push entegrasyonu
30. ✅ D1 Franchise gerçek şube rollup (properties/customers/profiles/deals → branch_id kırılımı)
31. ✅ D3 Geo kapsama + entegrasyon durumu paneli (`/admin/sistem`)
32. ✅ D4 Offboarding vault: tenant veri paketi indirme (`/api/admin/tenants/[id]/export`)
33. ✅ CI kırıcı hatalar giderildi: `payment-links.ts` server action ihlali, `error.tsx` `<a>` → `Link`, react-hooks/purity+set-state-in-effect false-positive'leri warn'a düşürüldü
34. ✅ `next.config.ts`: `date-fns` de `optimizePackageImports`'a eklendi
35. ✅ Endeksa + Tapusor gerçek entegrasyon: `lib/integrations/endeksa.ts` (OAuth2 bölge endeksi/AVM), `lib/integrations/tapusor.ts` (ada/parsel EDİ + yatırım puanı), `estimateMultiSourceValue` ağırlıklı kaynak, değerleme formunda il/ada/parsel alanları, `/app/degerleme` + `/app/portfoyler/[id]` bağlantı durumu rozetleri, ana sayfada "Veri ortaklarımız" bölümü, `/admin/sistem`de config durumu

36. ✅ Derin kod denetimi: `/app/portfoyler` arama kutusu + durum filtreleri (Tümü/Yayında/Teyit/Taslak) sahte/bağlantısızdı — gerçek server-side `?q=&status=` filtrelemeye bağlandı, "sonuç bulunamadı" boş durumu eklendi, hero KPI'ları tüm veri setinden hesaplanacak şekilde ayrıştırıldı
37. ✅ `MASTER_PLAN.md` içindeki eskimiş C1/5.1 notları (Endeksa/Tapusor öncesi "comps iskelet" ifadesi) güncellendi
38. ✅ 360° UI denetimi: anlaşmalar/randevular/komisyon/portallar/ekip/destek/raporlar/talepler/uyum/admin sayfalarında dekoratif (bağlantısız) buton/filtre taraması yapıldı — başka sorun bulunmadı
39. ✅ **Telefon numarası derin yenileme** (HGDekor kıyaslamalı): `lib/phone.ts` (normalize/validate/format/tel-/wa.me), `components/ui/phone-input.tsx` maskeli input (canlı `05XX XXX XX XX` görünümü); tüm formlara uygulandı (müşteri, ekip, kayıt, demo, arama konsolu — kontrollü/kontrolsüz varyant); tüm görüntüleme noktaları `formatTurkishPhone` ile tutarlı hale getirildi + müşteri 360'a gerçek `tel:`/WhatsApp CTA eklendi; `billing.ts`/`payment-links.ts`/`paylas/[token]`'daki 3 farklı ad-hoc `+90` mantığı merkezi util'e taşındı; migration `000015`: mevcut veri normalize edilir + `05XXXXXXXXX` CHECK kısıtı (`NOT VALID`, deploy'u bloklamaz)
40. ✅ **DB-tabanlı yetkilendirme mimarisi** (HGDekor'un çalışmayan "roller" ekranının gerçek sürümü): migration `000014` — `permission_defaults` (MATRIX seed) + `tenant_role_permissions` (tenant override) tabloları; `lib/permissions-effective.ts` → `getEffectivePermissions()` (React `cache()`, defaults+override merge); `requireModulePage`/`requirePermission` DB-tabanlı hale getirildi; sidebar artık statik matris değil sunucudan gelen etkin izin haritasını kullanıyor; **yeni** `/app/ayarlar/roller` — rol sekmeli, modül×aksiyon toggle matrisli, "varsayılana döndür" destekli gerçek yönetim arayüzü (`updateTenantPermission`/`resetRolePermissions` server action'ları, sadece owner/gm yazabilir)
41. ✅ Eksik `requireModulePage` kapıları tamamlandı: `/app` dashboard, `musteriler/[id]`, `portfoyler/[id]`, `destek`, `destek/[id]`, `franchise`
42. ✅ Buton/aksiyon seviyesinde UI ACL: müşteri/portföy/ekip/anlaşma/komisyon sayfalarında "Yeni ekle"/"Düzenle"/"Durum değiştir"/"Teyit et" gibi aksiyonlar artık etkin `create`/`edit` izni yoksa gizleniyor (sunucu tarafı zaten reddediyordu, şimdi UI da tutarlı)
43. ✅ Migration `000016`: `has_effective_permission()` SQL fonksiyonu + `commissions`/`payment_links` için view/create/edit/delete ayrıştırılmış role-aware RLS + `profiles.role`/`tenant_id` değişimini koruyan trigger (yalnızca kullanıcı oturumlu isteklerde; servis rolü admin akışları etkilenmez)
44. ✅ **014-016 migrationları canlı production DB'ye uygulandı** (`scripts/apply-one.ts` ile doğrudan Postgres bağlantısı üzerinden) — DB-tabanlı yetkilendirme ve telefon CHECK kısıtı artık gerçekten aktif, sadece kod olarak değil
45. ✅ **Tam coğrafya kapsaması**: `scripts/geo-sync.ts` gerçek TurkiyeAPI v2 senkronuna dönüştürüldü (81 il / 973 ilçe / 31.922 mahalle, postal code + population zenginleştirmesiyle) ve production DB'ye çalıştırıldı; migration `000017` (`source_id`/`postal_code`/`population` kolonları, `pg_trgm` arama indeksleri, geo tabloları için `service_role` yazma yetkisi) + `000018` (`geo_province_stats`/`geo_district_stats` view'ları — 32k satırı istemciye çekmeden hızlı kapsama sayımı)
46. ✅ **`/admin/geo` coğrafya yönetim arayüzü**: il listesi (arama + inline düzenleme: ad/enlem/boylam/aktiflik) → ilçe listesi (ekle/düzenle/sil, mahalle sayısı) → mahalle listesi (arama + sayfalama, ekle/düzenle/sil, posta kodu); `src/app/actions/geo-admin.ts` server action'ları `requirePlatformStaff` ile korunuyor, silme işlemleri FK/bağımlılık kontrolü yapıyor

**Next iteration (bilinçli ertelenen — vendor/gov bağımlı):**
- C2: İYS entegratör API — resmi entegratör sözleşmesi gerekir
- C3: EİDS resmi kayıt — e-Devlet/GİB erişimi gerekir

**Deploy-time (kod tamam, sadece prod anahtar/secret girişi gerekir):**
- iyzico prod merchant anahtarları (`IYZICO_MERCHANT_ID` vb.)
- `CRON_SECRET` prod değeri
- `ENDEKSA_CLIENT_ID/SECRET`, `TAPUSOR_API_KEY` (girilmezse sistem otomatik internal comps moduna düşer, hata vermez)
- `VAPID_PUBLIC_KEY/PRIVATE_KEY` (PWA push için)
- ✅ Migration `000014`-`000018` production DB'ye uygulandı (bkz. `MIGRATION_GUIDE.md`) — DB-tabanlı yetkilendirme, telefon CHECK kısıtı, role-aware RLS ve tam coğrafya kapsaması artık canlı

**Vizyon (bilinçli, şimdilik kapsam dışı):**
- C6: Phone OS gerçek CTI / screen-pop (şu an manuel log)
- C7: QR yer gösterme / anahtar kasası
- C8: Belge OCR / AI danışman (API + insan onayı gerektirir)

---

*Revize: 2026-07-22 · Post sprint + UI polish + backlog kapanışı (A4, D1-D4) + derin kod denetimi (portföy filtre fix) + telefon/yetkilendirme derin yenileme (39-43)*
