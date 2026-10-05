# Güvenlik denetimi 3

Kapsam: uygulama katmanı düzeltmeleri (S1 ajanı). SQL/migration/RLS düzeltmeleri S2 ajanındadır; bu belgede
"SQL (S2)" olarak işaretlidir. Her bulgu düzeltmeden önce kodda doğrulanmıştır; durum sütunu sonucu gösterir.

Durum işaretleri: [x] düzeltildi (uygulama katmanı) · [ ] bu ajanın kapsamı dışı / bekliyor.

## Bulgu tablosu

Tam denetim raporu (15 bulgu) bu belgeye işlendi. #1, #6, #7, #11, #13, #14 SQL/RLS katmanıdır (S2 migration ajanı); uygulama katmanı düzeltmeleri #2-#5, #8-#10, #12, #15'tir.

| # | Önem | Dosya:satır | Özet | Düzeltme | Durum |
|---|------|-------------|------|----------|-------|
| 1 | P1 | `supabase/migrations/20260728000123_approval_requests.sql:97-101` + `src/lib/oversight/approval-store.ts:30-46` | `approval_requests` politikası `for all` ve yalnız tenant koşullu: danışman PostgREST ile doğrudan `status='onaylandi'` kaydı yazarak ya da kendi bekleyen talebini onaylayarak onay kapısını atlatır; "kendi talebini onaylayamaz" kuralı yalnız uygulamada. | SQL (S2): ayrı INSERT/UPDATE politikaları (INSERT yalnız `bekliyor` ve `requested_by=auth.uid()`; karar alanı UPDATE yalnız yönetim kademesi ve `requested_by<>auth.uid()`), `consumed_at` sütunu. | [ ] SQL (S2) |
| 2 | P1 | `src/lib/oversight/approval-gate.ts:59-62` | Onay parmak izi yalnız `tür:kayıt`; değer/kanal bağlı değil (%10 indirim onaylanır, sonra 1 TL'ye düşürülür; hızlı export onayı tam export'ta kullanılır). | Parmak izine kanal (`quick`/`full`) eklendi; tüketim anında `approvalCovers` ile onaylı `requested_value` ile karşılaştırma: fiyat/komisyon onaylanandan daha derine inemez, export satır sayısı onaylananı aşamaz; aksi halde yeni talep açılır. `export.ts` `quick`, `api/export/[entity]` `full` gönderir. | [x] |
| 3 | P2 | `approval-gate.ts` / `approval-store.ts` (`isConsumed` + `consume`) | `isConsumed` + `consume` atomik değil (yarış); `consume` `logActivity` sonucunu yok sayıyor. | `consume` artık `boolean` döner. `approval_requests.consumed_at` sütunu varsa tek satırlık `update ... where consumed_at is null and status='onaylandi' returning` ile atomik tüketim (0 satır = yarış kaybedildi, reddedilir); sütun yoksa (42703/PGRST204) denetim kaydı yoluna güvenli düşüş (hata fırlatılmaz). Denetim kaydı yazılamazsa onay tüketilmiş sayılır ve işlem reddedilir. `isConsumed` okunamazsa "tüketilmiş" sayar. Sütunu ekleyen migration: SQL (S2). | [x] (uygulama) |
| 4 | P2 | `approval-gate.ts:186`, `oversight/store.ts:54` | `oversight_settings` okuma HATASINDA kapı fail-open (varsayılan kapalı). | `loadApprovalRules` yalnız tablo yokken (42P01/PGRST205) varsayılan kapalıya düşer; diğer hatada fırlatır; kapıdaki `.catch(defaults)` kaldırıldı, hata `status:"error"` döner (işlem durur). | [x] |
| 5 | P2 | `approval-store.ts:19-28`, `team/assignable-roles.ts:28` | Yönetici muafiyeti `MANAGEMENT_TIER_ROLES` ile team_lead'i de kapsıyor; toplu arşive alma kapıyı atlıyor. | Muafiyet önce `hasOfficeWideDataScope` ile daraltılmıştı; sonra HAFIZA §7 gereği YALNIZ owner/gm (`APPROVAL_EXEMPT_ROLES`) oldu, branch_manager artık onay talebi açar. `bulkUpdatePropertyStatus` `archived` yolu her ilan için `listing_delete` kapısından geçer (onayı geçenler arşivlenir, bekleyenler atlanıp bildirilir). Kapının yalnız uygulama katmanı olduğu `approval-store.ts` dosya yorumuna yazıldı. Karar yetkisi (`APPROVAL_DECIDER_ROLES`, eski adı `MANAGER_ROLES`; onay ekranı) bilerek değişmedi. | [x] |
| 6 | P1 | `supabase/migrations/20260816001500_listing_pool.sql:82-83, 139-144` | `listing_pool_entries` INSERT politikası geniş: `properties:create` izinli danışman başkasının ilanı için `claim_open_until` uzak tarihli kayıt açıp `assign_pool_entry(p_method:'claim')` ile ilanı ele geçirir (ilan kimliği herkese açık vitrin URL'sinde). | SQL (S2): INSERT politikasında `status='pending'`, `claim_open_until IS NULL`, `assigned_* IS NULL`; claim için RPC içinde havuz kaynaklılık doğrulaması. | [ ] SQL (S2) |
| 7 | P1 (taslak) | `supabase/proposed/20260820010000_survey_module.sql:167-182` | Anket tablolarında rol ayrımı yok (8 tabloda tek `for all` tenant politikası): danışman kendini anketör yapabilir, puanı değiştirebilir, malik telefonunu okuyabilir. | SQL (S2): tablo bazında ayrı politikalar; taslak migrations'a taşınmadan önce düzeltilmeli. | [ ] SQL (S2) |
| 8 | - | `platform-tenant-closure.ts`, `office-management.ts` (kod); RLS | Kapatma talebini açanın rolü kontrol edilmiyor, admin kartında gösterilmiyor. | İşlem öncesi `kvkk_requests.created_by` kullanıcısının hâlâ aynı ofisin aktif owner/gm'si olduğu doğrulanır (`requesterMayCloseOffice`); admin kartı "Talebi açan: ad (rol)" gösterir ve uygun değilse uyarır. RLS düzeltmesi: SQL (S2). | [x] (kod) |
| 9 | P2 | `api/export/kapanis/[entity]/route.ts`, `lib/admin/office-closure.ts:38-40` | İndirme kapısı "reddedilmemiş herhangi bir talebi" kabul ediyor. | `closureDownloadAllowed` yalnız platformun `completed` yaptığı talebi kabul eder; testler güncellendi. | [x] |
| 10 | P2 | `vitrin/[slug]/page.tsx:132`, `seo/sitemap-data.ts:61-66` | `vitrin_enabled=false` yalnız ana sayfayı kapatıyor. | `isVitrinEnabled` (`lib/vitrin-settings.ts`) ilan detayı, değerleme, favoriler, iki OG görseli, kayıtlı arama/fiyat alarmı/değerleme talebi action'ları ve favori API'sinde denetlenir (sütun yoksa bugünkü davranış: açık). Sitemap kapalı vitrinleri dışarıda bırakır (sütun yoksa süzgeç uygulanmaz). | [x] |
| 11 | P2 | `supabase/migrations/20260819020100_property_owner_info.sql:76-89` | UPDATE `WITH CHECK` yalnız tenant: danışman `property_id`/`customer_id` değerini başka ilana/müşteriye çevirip sahte malik bilgisi bağlar. | SQL (S2): `WITH CHECK` içine kapsam koşulu ya da `property_id` değişikliğini yasaklayan trigger. | [ ] SQL (S2) |
| 12 | P2 | `actions/survey-public.ts:189-207`, `anket/[token]/page.tsx:120-123` | Görev token'ında süre yok, action'da `is_sample` süzgeci yok. | `lib/surveys/task-expiry.ts`: `due_at` + 30 gün (`SURVEY_TASK_LINK_VALID_DAYS`) sonrası action ve sayfa reddeder; action ilanın `is_sample=false` olduğunu sayfayla aynı şekilde doğrular. | [x] |
| 13 | P2 | `supabase/migrations/20260816001300_advisor_profiles_private.sql:129-142` | Danışman kendi `*_enc`/`*_last4` alanlarını doğrudan yazabilir; uygulama doğrulamasını (TC sağlaması, IBAN mod97) atlar. Bütünlük sorunu, açık değer sızıntısı değil. | SQL (S2): sütun düzeyinde yazma kısıtı ya da SECURITY DEFINER RPC. | [ ] SQL (S2) |
| 14 | P2 (dalga dışı) | `supabase/migrations/20260817000230_coupons.sql:65-91` | `redeem_coupon` ofis başına sınır koymuyor: tek ofis aynı kuponu her faturada kullanıp global kotayı tüketebilir. | SQL (S2): `max_per_tenant` ya da `unique(coupon_id, tenant_id)`. | [ ] SQL (S2) |
| 15 | Düşük | `seo/sitemap-data.ts:109-117` | Danışman sorgusunda `is_sample` süzgeci yok. | `.eq("is_sample", false)` eklendi. | [x] |

## Temiz çıkan alanlar

Denetim ajanının kanıtladığı temiz alanlar (yanlış pozitifler elendi): PII şifreleme (`pii-crypto.ts`: AES-256-GCM, rastgele IV,
`profileId:alan` AAD, anahtar yoksa fail-closed, açık TC/IBAN DB/log/audit/AI bağlamına gitmiyor, "göster" denetim kaydı yazılamazsa değer dönmüyor,
`advisor_private` RLS yalnız owner/gm ve kişinin kendisi); sahiplik devri taslağı (service_role-only, `search_path=''`, `FOR UPDATE`);
`platform_revoke_user_sessions`, faturalama duraklatma RPC'leri ve `effective_seat_limit` (yalnız service_role); `oversight_center` RLS;
iki yeni cron (`anket-gorevleri`, `havuz-atama`) CRON_SECRET + heartbeat; yeni `createAdminClient` kullanımları allowlist'te ve tenant filtreli;
`/anket` sayfası müşteri adı göstermiyor; JSON-LD kaçışı doğru; doğrudan `api.openai.com` çağrısı yok; yeni server action'larda yetki kapısı var.
P0 (ofisler arası sızıntı, açık TC/IBAN) bulunamadı. Bu ajanın kendi kod okumasıyla temiz bulduklarına ek olarak:

- Kapanış paketi rotası: oturum, `impersonating` reddi, yalnız aktif owner, RLS'li istemci (service_role yok) ve hız sınırı yerinde.
- `/api/export/[entity]` ve `export.ts`: `requirePermission` kapısı onay kapısından önce, satır içeriği denetim kaydına girmiyor.
- Anket sayfası: müşteri `is_sample` + `deleted_at` süzgeci mevcuttu; yalnız ilan için action tarafı eksikti.
- Vitrin ana sayfası ve `generateMetadata`: `enabled` kontrolü zaten vardı.

## Notlar ve kalan riskler

- Onay kapısı YALNIZ uygulama katmanıdır. `approval_requests` RLS'i tenant geneli yazmaya izin veriyorsa aynı ofisin
  kullanıcısı PostgREST ile doğrudan onay satırı yazabilir; bu SQL (S2) tarafında kapatılmalıdır.
- `consumed_at` sütunu eklenene kadar tüketim denetim günlüğü yoluyla çalışır (atomik değildir); sütun gelince otomatik atomik olur.
- Eski (kanal içermeyen) parmak izli onaylar yeni sürümde eşleşmez; 48 saatlik pencerede yeniden talep gerekir.
- `kvkk_requests` kaydını açan action (`actions/kvkk-requests.ts`) kapatma/veri indirme türleri için owner/gm şartı koşmuyor; bu bu ajanın dosya sahipliği dışındadır, işleme anındaki doğrulama bunu telafi eder.
