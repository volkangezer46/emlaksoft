# Güvenlik denetimi 3

Kapsam: uygulama katmanı düzeltmeleri (S1 ajanı). SQL/migration/RLS düzeltmeleri S2 ajanındadır; bu belgede
"SQL (S2)" olarak işaretlidir. Her bulgu düzeltmeden önce kodda doğrulanmıştır; durum sütunu sonucu gösterir.

Durum işaretleri: [x] düzeltildi (uygulama katmanı) · [ ] bu ajanın kapsamı dışı / bekliyor.

## Bulgu tablosu

Denetim ajanından bu ajana yalnız aşağıdaki 9 bulgunun özeti iletildi (#2, #3, #4, #5, #8, #9, #10, #12, #15).
Kalan numaralar (#1, #6, #7, #11, #13, #14) SQL/RLS katmanı (S2) veya denetim ajanının tam raporundadır; özetleri
bu ajana verilmediği için burada UYDURULMADI, "özet iletilmedi" olarak bırakıldı.

| # | Önem | Dosya:satır | Özet | Düzeltme | Durum |
|---|------|-------------|------|----------|-------|
| 1 | - | - | Özet bu ajana iletilmedi | - | [ ] kapsam dışı |
| 2 | P1 | `src/lib/oversight/approval-gate.ts:59-62` | Onay parmak izi yalnız `tür:kayıt`; değer/kanal bağlı değil (%10 indirim onaylanır, sonra 1 TL'ye düşürülür; hızlı export onayı tam export'ta kullanılır). | Parmak izine kanal (`quick`/`full`) eklendi; tüketim anında `approvalCovers` ile onaylı `requested_value` ile karşılaştırma: fiyat/komisyon onaylanandan daha derine inemez, export satır sayısı onaylananı aşamaz; aksi halde yeni talep açılır. `export.ts` `quick`, `api/export/[entity]` `full` gönderir. | [x] |
| 3 | P2 | `approval-gate.ts` / `approval-store.ts` (`isConsumed` + `consume`) | `isConsumed` + `consume` atomik değil (yarış); `consume` `logActivity` sonucunu yok sayıyor. | `consume` artık `boolean` döner. `approval_requests.consumed_at` sütunu varsa tek satırlık `update ... where consumed_at is null and status='onaylandi' returning` ile atomik tüketim (0 satır = yarış kaybedildi, reddedilir); sütun yoksa (42703/PGRST204) denetim kaydı yoluna güvenli düşüş (hata fırlatılmaz). Denetim kaydı yazılamazsa onay tüketilmiş sayılır ve işlem reddedilir. `isConsumed` okunamazsa "tüketilmiş" sayar. Sütunu ekleyen migration: SQL (S2). | [x] (uygulama) |
| 4 | P2 | `approval-gate.ts:186`, `oversight/store.ts:54` | `oversight_settings` okuma HATASINDA kapı fail-open (varsayılan kapalı). | `loadApprovalRules` yalnız tablo yokken (42P01/PGRST205) varsayılan kapalıya düşer; diğer hatada fırlatır; kapıdaki `.catch(defaults)` kaldırıldı, hata `status:"error"` döner (işlem durur). | [x] |
| 5 | P2 | `approval-store.ts:19-28`, `team/assignable-roles.ts:28` | Yönetici muafiyeti `MANAGEMENT_TIER_ROLES` ile team_lead'i de kapsıyor; toplu arşive alma kapıyı atlıyor. | Muafiyet `hasOfficeWideDataScope` (owner/gm/branch_manager) ile sınırlandı. `bulkUpdatePropertyStatus` `archived` yolu her ilan için `listing_delete` kapısından geçer (onayı geçenler arşivlenir, bekleyenler atlanıp bildirilir). Kapının yalnız uygulama katmanı olduğu `approval-store.ts` dosya yorumuna yazıldı. Karar yetkisi (`MANAGER_ROLES` onay ekranı) bilerek değişmedi. | [x] |
| 6 | - | - | Özet bu ajana iletilmedi | - | [ ] kapsam dışı |
| 7 | - | - | Özet bu ajana iletilmedi | - | [ ] kapsam dışı |
| 8 | - | `platform-tenant-closure.ts`, `office-management.ts` (kod); RLS | Kapatma talebini açanın rolü kontrol edilmiyor, admin kartında gösterilmiyor. | İşlem öncesi `kvkk_requests.created_by` kullanıcısının hâlâ aynı ofisin aktif owner/gm'si olduğu doğrulanır (`requesterMayCloseOffice`); admin kartı "Talebi açan: ad (rol)" gösterir ve uygun değilse uyarır. RLS düzeltmesi: SQL (S2). | [x] (kod) |
| 9 | P2 | `api/export/kapanis/[entity]/route.ts`, `lib/admin/office-closure.ts:38-40` | İndirme kapısı "reddedilmemiş herhangi bir talebi" kabul ediyor. | `closureDownloadAllowed` yalnız platformun `completed` yaptığı talebi kabul eder; testler güncellendi. | [x] |
| 10 | P2 | `vitrin/[slug]/page.tsx:132`, `seo/sitemap-data.ts:61-66` | `vitrin_enabled=false` yalnız ana sayfayı kapatıyor. | `isVitrinEnabled` (`lib/vitrin-settings.ts`) ilan detayı, değerleme, favoriler, iki OG görseli, kayıtlı arama/fiyat alarmı/değerleme talebi action'ları ve favori API'sinde denetlenir (sütun yoksa bugünkü davranış: açık). Sitemap kapalı vitrinleri dışarıda bırakır (sütun yoksa süzgeç uygulanmaz). | [x] |
| 11 | - | - | Özet bu ajana iletilmedi | - | [ ] kapsam dışı |
| 12 | P2 | `actions/survey-public.ts:189-207`, `anket/[token]/page.tsx:120-123` | Görev token'ında süre yok, action'da `is_sample` süzgeci yok. | `lib/surveys/task-expiry.ts`: `due_at` + 30 gün (`SURVEY_TASK_LINK_VALID_DAYS`) sonrası action ve sayfa reddeder; action ilanın `is_sample=false` olduğunu sayfayla aynı şekilde doğrular. | [x] |
| 13 | - | - | Özet bu ajana iletilmedi | - | [ ] kapsam dışı |
| 14 | - | - | Özet bu ajana iletilmedi | - | [ ] kapsam dışı |
| 15 | Düşük | `seo/sitemap-data.ts:109-117` | Danışman sorgusunda `is_sample` süzgeci yok. | `.eq("is_sample", false)` eklendi. | [x] |

## Temiz çıkan alanlar

Denetim ajanının "temiz çıkan alanlar" özeti bu ajana iletilmedi; burada uydurulmadı. Bu ajanın kendi
doğrulamasında şunlar temiz bulundu (kod okunarak):

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
