# EmlakSoft — Proje Hafızası (TEK MERKEZ)

Bu dosya projenin **tek kayıt defteridir**. Yeni bir oturum/ajan işe başlarken önce bunu okur; durumu sıfırdan
taramaz. Bir iş bittiğinde, bir karar alındığında ya da bir şey yayınlandığında BURASI güncellenir.
Ayrıntı için ilgili belgeye bağlanır (içerik burada kopyalanmaz). Son güncelleme: 2026-10-05.

## 1. Yayın durumu (en kritik)

- **`origin/main` = CANLI (2026-10-05): `c5a6d32f`.** Yerelde yayınlanmamış commit YOK; son tam doğrulama (tsc, eslint, vitest, check:*, build) bugün yapıldı.
  Bundan sonraki ajan çalışmaları ayrı worktree dallarındadır ve birleştirme ajanı doğrulamadan `main`'e girmez.
- **Push:** otomatik izin sınıflandırıcısı ajan `git push`'unu reddedebilir; push/deploy sahibin ya da birleştirme akışının işidir (Vercel `main` push'unda deploy eder). Aşılmaya çalışılmaz.
- Eski "~70 commit önde / push engelli" notları KALDIRILDI (hepsi yayınlandı). Tarihsel kayıt için `git log`.

## 2. Migration durumu (KRİTİK: hepsi sahibin işi)

**CANLI DB (2026-10-05): `20260826000100 … 20260826000800` UYGULANDI; bekleyen migration YOK.** Bunlar: EF kontör (000100-000300), TL hesap kredisi (000400-000500),
referans/ortak motoru (000600), kayıtlı kart (000700), varsayılan program seed (000800). Önceki pencereler (P1-P12, `20260825000100..001300`) da uygulanmıştır.
**Depoda YENİ, canlıda UYGULANMAMIŞ dosyalar:** `20260826000900` (hotfix, başka ajan), `20260826001000_growth_dashboard_roles.sql` (PB15: `growth_my_dashboard` /
`growth_my_partner_dashboard` yalnız owner/gm; +rollback), `20260826001100` (başka ajan). Uygulama sırası ve doğrulama: `docs/runbooks/YAYIN_PENCERESI_2.md` §8; her biri
backup/PITR teyidi + `check:migrations -- --database` + `db:migrate -- --dry-run` sonrası `--only` ile. Düz `npm run db:migrate` YASAK değildir ama pencere sırasını sahip bilir; bekleyen listesi için dry-run esastır.
**Migration sırası uyarısı:** aynı fonksiyonu yeniden yazan migration'lar önceki düzeltmeyi ezebilir; 001000 B12'yi ezdi (money_visible + yuvarlanmış davet tutarı kayboldu), `20260826001900_growth_dashboard_b12_reapply.sql` geri getirdi (DOGRULANMADI; sahip uygulayacak).
Aşağıdaki §2 devamı TARİHSELDİR (uygulama anındaki notlar); güncel durum yalnız bu paragraftır.

**(Tarihsel) 2026-10-05 ilk durum, kullanıcı onayı + yedek/PITR teyidiyle, `--only` ile pencere pencere:** `migrations/` altındaki 41 dosyanın **40'ı CANLIDA UYGULANDI**
(P1-P11b, sec3 düzeltici ve P5 migration'ları ana migration'larıyla aynı pencerede; ilk ikisi — telefon CHECK + kayıp nedeni seed — yanlışlıkla `--help` ile uygulanmıştı, bkz. memory
`feedback-never-probe-apply-migrations`). `check:migrations -- --database` drift/checksum sorunu YOK. `db:rls-audit`: tenant sızıntısı yok; `coupon_redemptions` ve `direct_file_uploads`
"RLS açık, politika yok" = yalnız service_role erişimi (beklenen). **KALAN (canlıda UYGULANMADI):** 2026-10-05'te `supabase/proposed/` taslakları kullanıcı onayıyla `migrations/`'a TERFİ ETTİ:
`20260825000100..001300` (13 dosya; eski ad → yeni ad, uygulama sırası `--only` listesi ve dosya başına salt-okunur doğrulama:
`docs/runbooks/YAYIN_PENCERESI_2.md`). Sıra: malik bağlantısı → coğrafya → fiyat bütünlüğü (000300) → koltuk fiyat kilidi → duraklatma/extra_seats
(000500, D bölümü ÇIKARILDI) → koltuk satışı (000600) → anket → büyüme + tıklama sayacı → AI kredi → vitrin ayarları + SEO opt-in → sahiplik devri →
**EN SON, AYRI gün:** `20260816000500_commission_earnings_privacy.sql` (P12, kazanç gizliliği RLS, davranış değiştirir + rol smoke'u). Düz `npm run db:migrate`
YASAK: bekleyenleri ad sırasıyla uygular ve P12'yi (en küçük numara) İLK sıraya koyar. `supabase/proposed/`'da yalnız perf indeks önerileri kaldı
(`CREATE INDEX CONCURRENTLY` runner transaction'ında çalışmaz + ölçülmemiş; terfi ETMEDİ). K4 `is_document` dalda. Sec3 rol smoke senaryoları (runbook §5) HENÜZ yapılmadı.
Aşağıdaki liste TARİHSEL envanterdir (uygulananlar dahil); güncel bekleyenler için `npm run db:migrate -- --dry-run`.

**PB9 EmlakFiyati kontör (CANLIDA UYGULANDI, 2026-10-05):** `20260826000100_ef_credit_wallet`
(defter `ef` birimi, `ef_credit_reservations`, 7 service_role RPC: `config.ts` EF_RPC birebir; 0 kontör = doğrudan kesinleşmiş kayıt,
kontör süresiz, `ef_credit_ready()` SQL editöründe false) → `20260826000200_ef_reports` → `20260826000300_ef_credit_pack_fulfillment`
(fulfill/v2 `credit_pack`; taban 000600 gövdesi bayt bayt, md5 kanıtı `src/lib/ef-credits/ef-wallet-sql-contract.test.ts`).
Sıra/sorgular `YAYIN_PENCERESI_2.md` §7; prova `npm run db:rehearse -- --yes-i-understand-locks --ef` (koşulmadı). TS kontör akışı YOK.

**PB10 TL HESAP KREDİSİ (CANLIDA UYGULANDI, 2026-10-05):** `20260826000400_try_credit_wallet` (defter `try` birimi, `try_credit_reservations`, service_role RPC'ler:
`try_credit_balance/grant/reserve/commit/release/reverse`, ofis okuma `try_credit_my_overview()` + `try_credit_movements` görünümü; bakiye = defter TEKRAR OYNATMA, vade FIFO,
clawback eksiye düşebilir ama harcanamaz) → `20260826000500_try_credit_invoice_payment` (`try_credit_fulfill_invoice` fulfill/v2'yi İÇERDEN çağırır, fulfill gövdelerine DOKUNMAZ;
`try_credit_invoice_hold/release_invoice/release_dead/refund_invoice`, `try_credit_ready()`). Sıra: 000100 (source CHECK refund/bonus + meta) SONRA. TS: `src/lib/try-credits/*`
(sözleşme `config.ts`, testler `try-wallet-sql-contract.test.ts` + pglite'lı `try-wallet-sql-exec.test.ts`: `npm i --no-save @electric-sql/pglite`). Ödeme: faturada "Hesap kredimi kullan"
(`use_credit=1`), tek faturada en fazla `platform_settings.try_credit.max_invoice_share` (varsayılan 0.5; 1 = tam kredi/iyzico'suz), iyzico yalnız nakit kalanı; iade önce nakitten düşer, artan kredi geri yazılır.
`/app/abonelik?sekme=cuzdan` Cüzdan bölümü. Ortaklık/tavsiye işi `try_credit_grant/reverse`'e bağlanır (kind: referral|partner|campaign|manual|bonus|refund).

**PB11 REFERANS/ORTAK MOTORU (CANLIDA UYGULANDI; ortak/nakit bayrakları KAPALI, referans bayrağı 000800 seed'iyle AÇIK):** `20260826000600_growth_referral_engine` (000800 + 000900 + 000400/000500 SONRASI). Müşteri-getir-müşteri (Faz 1, çift taraflı, kredi nakde çevrilmez):
tetikleyici = davet edilen ofisin İLK GERÇEK ödemesi (`growth_real_payment`: paid plan faturası, demo/tam-kredi/iade yok) + `hold_days`; davetçiye 1 aylık paket bedeli TL kredisi (`try_credit_grant`, idem `ref-claim-<claim>`),
kademe bonusu 3./10. referans (rozet sayımdan türetilir, depolanmaz), yıllık tavan (aylık bedel katı), kötüye kullanım bayrakları (aynı vergi no / telefon / kurumsal e-posta alan adı → `pending` inceleme; aynı tenant red; hız sınırı),
iade/iptal/chargeback → `reversed` + `try_credit_reverse` clawback. Faz 2 (ortak, nakit): kademe %20/25/30, ilk 12 ay yinelenen, min eşik, yalnız vergi mükellefi + belge no/tarih (dış ödeme) veya hesap kredisi;
`growth_partner_enabled` + AYRI `growth_cash_payout_enabled` kapalıyken komisyon/ödeme ÜRETİLMEZ. TS: `src/lib/growth/engine.ts` (RPC sarmalayıcıları, istemci enjekte, asla fırlatmaz) + `program.ts` (saf), kancalar:
`fulfillment.ts` (`registerClaimSafe`, fulfill SQL'ine dokunmaz), `platform-billing.ts` iade, `store.ts` kayıt (hoş geldin kredisi), cron `growth-claims`. Test: `growth-engine-contract.test.ts` + pglite'lı `growth-engine-sql-exec.test.ts`
(`PGLITE_MODULE=...` ya da `npm i --no-save @electric-sql/pglite`). Tasarım/parametreler/açık riskler: `docs/design/REFERANS_PROGRAMI.md`. Aktivasyon: /admin/growth "Aktivasyon" hazırlık kontrolü → süper admin bayrağı açar.

(Eski not) Canlıda uygulanan son: `20260813000300`. Aşağıdakilerin HİÇBİRİ uygulanmadı; kod hepsinde "etkin değil" ile zarifçe çalışır.
Sıra: yedek/PITR doğrula → `npm run check:migrations -- --database` → `npm run db:migrate -- --dry-run` → `npm run db:migrate` → `npm run db:rls-audit`.

**Ek (2026-10-05):** `20260821000100` mahalle notları · `20260821000200` yasal kayıt defteri · `20260821000300` evrak linkleri ·
**`20260823000100..000600` güvenlik denetimi 3 düzeltici migration'ları (approval_requests RLS+consumed_at, listing_pool insert/claim,
kvkk_requests rol, property_owner_info update kapsamı, advisor_private PII biçim CHECK, kupon max_per_tenant) — ilgili ana
migration'larla AYNI pencerede uygulanmalı.** **P5 (`20260824001100..001300`):** mahalle notu sahip/yönetici kapsamı, evrak linki yazma kapsamı, `increment_listing_view`/`increment_referral_click` anon+authenticated
EXECUTE revoke (ilgili ana migration'ların ARDINDAN, aynı pencerede). **Bilinen açık (sahip kararı, P5 notu `GUVENLIK_DENETIMI_3.md` Ek):** `properties` UPDATE RLS'i
onay kapısını atlayarak doğrudan PostgREST ile fiyat düşürmeye izin veriyor; `property_price_history` silinebilir; 29 etkin tenant-only yazma politikası ayrı
düzeltici migration bekliyor (`src/lib/sql-rls-pattern-contract.test.ts` istisna listesi). Terfi sonrası adlar (2026-10-05): coğrafya `20260825000200`, sahiplik devri `20260825001300`, fiyat bütünlüğü `20260825000300`,
duraklatma/extra_seats `20260825000500` (D bölümü çıkarıldı), koltuk satışı `20260825000600`; sıra 000300 → 000500 → 000600 korunur.
**Koltuk satışı SQL (`migrations/20260825000600_seat_purchase_fulfillment.sql`, eski taslak 20261005000900, uygulanmadı):** `fulfill_billing_payment` + `_v2` (v2 ayrıca dönemi uzatıyordu: ikisi de
tam gövdeyle yeniden yazıldı), koltuk tetikleyicileri `effective_seat_limit`'e bağlı, `seat_purchase_ready()` (SQL editöründe false döner, doğrulama için başlıktaki katalog sorgusu).
Ön koşul bloğu canlı gövde md5'ini doğrular, sapmada DURUR. **Açık sahip kararları:** (1) yenilemede ek koltuk ÜCRETLENDİRİLMİYOR (ilk dönemden sonra bedava kalır; geniş satıştan
önce karar), (2) dahil koltuk iki kaynaktan okunuyor (kod `limits.seats`=15, DB `plan_entitlements.seat_limit`=20 Profesyonel), (3) koltuk fiyat kilidi yazılmıyor,
(4) koltuk azaltma kodda/şemada yok, yan menü kullanım rozeti ek koltuğu saymıyor. Rollback sırası: 20260825000600 → 20260825000500 → 20260825000300.
Toplam uygulanmayan migration dosyası: 14 (P12 `20260816000500` + `20260825000100..001300`); kesin liste salt-okunur `npm run db:migrate -- --dry-run`.

`supabase/migrations/` (ilk 31 dosya, uygulanmayan): 20260814000100 telefon CHECK · 20260815000100 kayıp nedeni seed ·
20260816000100..001000 (komisyon payı/plan/ödeme, **000500 kazanç gizliliği RLS = davranış değiştirir, AYRI PENCERE**, hedef, atama kuralı) ·
001100 kampanya claim · 001200 atama kuralı ilan hedefi · 001300 danışman özel · 001400 uzmanlık/bölge · 001500 ilan havuzu ·
001600 örnek veri kapsamı · 001700 tenant_modules · 001790 SEO 404 · 010100 varsayılan deneme günü · 010200 oturum kapatma ·
20260817000210 Business planı · 000220 fiyat kilidi · 000230 kuponlar · 20260819010500 abonelik iptal/şube telefonu ·
010600 kvkk_requests · 020100 ilan sahibi bilgisi · 020200 havuz profil bayrakları · 20260820000100 ofis kontrol.

`supabase/proposed/` (TARİHSEL; 2026-10-05'te perf indeksleri hariç hepsi `20260825000100..001300` olarak TERFİ ETTİ): vitrin ayarları (060100→001100) ·
vitrin bölümleri/SEO opt-in (010700→001200) · büyüme/referral (20260819000100→000800) · tıklama sayacı (20260822000100→000900) · sahiplik devri (→001300) ·
faturalama duraklatma/koltuk (→000500) · AI kredi (→001000) · anket modülü (→000700) · malik bağlantısı (→000100) · coğrafya (→000200) ·
fiyat bütünlüğü (→000300) · koltuk fiyat kilidi (→000400) · koltuk satışı (→000600). Perf indeksleri proposed'da kaldı (CONCURRENTLY).

**Fiyat bütünlüğü (tam gövdeli, `pg_get_functiondef+replace` YOK):** `supabase/migrations/20260825000300_billing_plan_amount_integrity.sql` (eski taslak 20261005000500)
(+ rollback). `update_tenant_plan_subscription`, `fulfill_billing_payment` (10 arg), `provision_registration`, `convert_demo_request_to_tenant`
fonksiyonlarını yeniden yazar (tutar plan tanımından, yıllık = aylık×10, fiyat kilidi yazılır, Business dahil). **`20260825000500_billing_pause_proration_business_seats.sql`
(eski 20261005000800) dosyasının D bölümünün YERİNE geçer; terfide D bölümü ÇIKARILDI.** Terfide `plan_monthly_amount` yedek tabanı plans.ts ile
eşitlendi (990/5990 → 749/4990); fulfill gövdesi değişmedi (000600 md5 tabanı korunur).
Bağımlılıkları: 20260731000140, 20260802000300/400, 20260809000000, 20260810000100, 20260816010100, 20260817000210/220. Uygulanmadan Founders /
yeni fiyat / admin plan değişimi KAPALI kalmalı. Ayrıca 20260731000138'den kalan 9 argümanlı `fulfill_billing_payment` overload'u eski sabitleri
taşıyor (ayrı temizlik migration'ı önerilir). Mevcut abonelik tutarları bu migration ile DÜZELTİLMEZ (korunur); veri düzeltme ayrı karar.
Katalog kuralı TS `resolveCatalogSettings` ile birebir aynı (ayar yoksa onaylı katalog; ayar var ama plan için fiyat yoksa `plans.ts` tabanı).

**KURALLAR:** uygulanmış dosya değiştirilmez (forward-only); enum ADD VALUE + kullanımı ayrı dosya; `properties`↔`customers`
ikinci FK eklenince PostgREST gömmeleri FK adıyla yazılmalı. **Güvenlik düzeltici migration'lar (denetim 3: approval_requests,
listing_pool_entries, kvkk_requests, property_owner_info, advisor_private, coupons, anket) ilgili migration'larla AYNI pencerede
uygulanmalı; yoksa RLS delikleri açık kalır.** K4 `is_document` migration'ı (`20260818000400`, K4 dalında) KODDAN ÖNCE gerekir.

## 3. Bekleyen / engelli işler

**GÜNCEL AÇIK İŞLER (2026-10-06; aşağıdaki eski maddeler tarihsel olabilir, çelişirse bu liste geçerlidir):**
- **PB44 self-servis kurulum (2026-10-06, KODDA; migration CANLIYA UYGULANMADI):** `20261006000600_purge_sample_data_rpc.sql` (+rollback; order 29.95): `purge_tenant_sample_data` RPC + tenants'a `office_type`/`focus_segments`/`work_district_ids`. Kod RPC/sütun yokken eski yola düşer (§19).
- **Perf turu 1 (2026-10-06) KARARI:** ajan yazımı `20261006000200_perf_indexes` ve `20261006000300_nav_badge_cache` + `nav-badges-refresh` cron'u SİLİNDİ (uygulanmadı): DB zaten indeksli (pg_indexes doğrulandı: idx_deals_tenant_stage, idx_offers_tenant_status, idx_demands_tenant_status_created, idx_tasks_assignee, idx_customers_phone...), dosya var olmayan tablolara (contacts/events/demands) yazıyordu, `CONCURRENTLY` runner transaction'ında çalışmaz, nav cache SQLite `changes()` içeriyordu. Rozetler RLS'li gerçek sayımda kaldı; cron sayısı 36. Yeni indeks önerisi için önce pg_indexes'e bak. Kalıcı hız işi: kabuk tek RPC (`app_shell_bootstrap`, rozet sayımları dahil) + dashboard snapshot RPC'leri (`data-batch.ts` imzaları) + `loading.tsx` + dinamik import (perf turu 2).
- **Kurumsal kapsam sistemi (PB40) CANLIDA (2026-10-06):** `20261006000100..000103` uygulandı (user_scopes, scope_overrides, access_audit_log, has_permission_with_scope RPC — RPC `customer_demands`+`customers.assigned_to` ve `deals.assigned_to` üzerinden çalışır; `demands` tablosu YOKTUR).
- Yeni migration dosyaları canlıda değil: `000900` (hotfix), `001000` (büyüme paneli rol kapısı), `001100` (§2). Sırası/doğrulaması: `docs/runbooks/YAYIN_PENCERESI_2.md` §8.
- Ofis Merkezi (PB43, §16): `20261006000500` (office_center izin seed'i) → `20261006000510` (pool_assignments); seed uygulanmadan 000510 ön koşul bloğu DURUR.
- Hız turu 2 (PB42, §20): `20261006000400` (app_shell_bootstrap) → `20261006000410` (dashboard snapshot RPC'leri) CANLIYA UYGULANMADI; kod RPC yokken eski yola düşer (60 sn yoklama). Uygulandıktan sonra gerçek süre `EMLAKSOFT_SERVER_TIMING=1` ile ölçülmeli.
- Release çifti (`RELEASE_MIGRATION` + `_CHECKSUM`) her yeni uygulamadan sonra güncellenir (DEPLOY.md).
- Üretim env: `ADVISOR_PII_KEY`, `PLATFORM_MFA_ENFORCEMENT=on` (yayın öncesi), `IYZICO_BASE_URL=https://api.iyzipay.com` (sandbox değeriyle canlı ödeme alınmaz), `PLATFORM_SECRETS_KEY`, `EMLAKFIYATI_API_KEY`/admin anahtarı.
- iyzico iade OTOMATİK DEĞİL: panelden elle + `recordInvoiceRefund` + kontör/kredi clawback (`docs/runbooks/IYZICO_IADE.md`). Günlük `manual_review`/`refund_required` kontrolü (Admin > Faturalama > Ödeme uyarıları).
- Admin "Hesap kredisi yükle/geri al" ekranı YOK: TL kredi RPC'leri service_role ister ve bu iş için `admin-client-allowlist.ts`'te kayıtlı yol yok. Eklenecekse allowlist satırı sahibin/denetim akışının kararıdır (`scripts/audit-admin-client.ts --write`).
- Ortak/nakit ödeme bayrakları (`growth_partner_enabled`, `growth_cash_payout_enabled`) KAPALI; vergi/stopaj ve sözleşme metni mali müşavir onayı bekler.
- Kazanç gizliliği (P12) ve sec3 rol smoke senaryoları: runbook'taki duman testleri; `properties` UPDATE RLS açığı sahip kararı (eski madde, hâlâ geçerli).
- Kayıtlı kartla otomatik yenileme (`billing.auto_renew_enabled`) KAPALI; iyzico off-session onayı ve CF retrieve alanları doğrulanmadan açılmaz.
- Dış uptime izleyici (cron kaçırma/site erişimi) kurulmadı: öneri `docs/runbooks/IYZICO_IADE.md` §Alarm.
- **Menü IA (2026-10-06, menü ajanı dalı):** `main`'de Ofis Merkezi iskeletiyle gelen 2 kırmızı test menü ajanının sahası değil, Ofis Merkezi
  ajanına ait: `modules.test.ts` "27 kapatılabilir modül" (registry 28) ve "kapatılabilir her rota requireModulePage'e href geçirir"
  (`/app/ofis-merkezi/page.tsx` istemci bileşeni, kapı yok). Ayrıca `/app/ayarlar/yetkilendirme` nav-config'te Ayarlar sekmesi olarak
  TANIMLI ama sayfa dosyası başka ajanın dalında; birleşmeden önce o dal gelmeli (yoksa sekme 404'e gider).

- **Uzman paneli kararı (2026-10-05):** canlıya almadan zorunlu paketler (P1-P7), ilk 30 gün planı, sahip kararları (S1-S13) ve "asla yapılmayacaklar" için `docs/design/PANEL_KARAR_1.md`.
- **K4 dalı** (`worktree-agent-aaa0895d41f425d97`): portföy düzenleme/mobil/anahtar/açık ev/belge. Public medya sorguları
  `is_document` sütununa bağlı → migration uygulanmadan `main`'e alınmaz (public vitrinde görsel kaybolur).
- **Fiyat kararı (sahip):** veritabanı fonksiyonu `update_tenant_plan_subscription` plan değişince tutarı eski sabit
  990/2490/5990/12900'e yazıyor ve kayıtlı tutarı eziyor; kampanya/kilitli fiyat ödemeye YANSIMIYOR (`price_lock_*` yazılmıyor).
- "Öncelikli destek / Özel onboarding / SLA" gibi mekanizması olmayan hizmet vaatleri varsayılan kataloglardan ÇIKARILDI (admin plan editöründen elle eklenebilir).
- Admin "Önerilen kataloğu uygula" yapılana dek `plan_entitlements` limitleri eski (Profesyonel 20, yeni 15).
- Havuza yalnız elle ilan ekleme bağlı (içe aktarma/portal/ağ `enqueueListingPool`'a bağlı DEĞİL).
- Aktivite akışı tek zaman çizgisi değil; AI asistan SMS kartı ve gelen kutusu `SmsDialog` popup'ı kaldı; "Lead skoru" metni "Aday skoru" yapıldı.
- Raporlar/ana ekran komisyon özeti SQL toplulaştırmalarından beslenir (is_sample süzmez; eşik uygulanamadı, migration ister).
- Sahiplik devri kodu YOK (atomik RPC yok; taslak + tasarım var). Abonelik duraklatma/oransal yükseltme sadece taslak.
- Ö-7, Ö-8 (oneri listesi) ve organik büyüme paketlerinin geri kalanı, F1-F5 (aşağıda ajanlar), devir dosyası + Codex komutu.

## 4. Çalışan ajanlar (2026-10-06; raporlar gelince bu bölümü güncelle)

Yerelde birleşenler (hepsi `main`'de, push bekliyor): **perf optimizasyonu (2026-10-06, code ready),** güvenlik denetimi 3 (kod + SQL düzeltmeleri; rapor `docs/design/GUVENLIK_DENETIMI_3.md`),
F1/F4 (kayıt defteri, evrak linki), F2/F3/F5 (doğal dil arama, foto kalite, mahalle notu), organik büyüme, AI kredi ölçümü,
müşteri zekâsı + aday hızı, ar-ge-baskani ajan tanımı (`.claude/agents/ar-ge-baskani.md`).
Hâlâ çalışanlar: **coğrafya tek merkez** (`src/lib/geo`, `/admin/geo`; üyelik kaydı dahil tüm formlar), **koltuk fiyatlama motoru**
(`src/lib/billing/seat-pricing.ts`; ardından satın alma akışı + public hesaplayıcı ajanları), **mega menü yönetimi** (`/admin/site-menu`),
uzman panel tartışması (tur 1: ofis sahibi, danışman/müşteri, strateji bitti; mühendis bekleniyor → tur 2 itiraz → tur 3 hakem).
Panel çıktıları geçici klasörde (scratchpad/panel); kalıcı kararlar `docs/design/PANEL_KARAR_1.md`'ye yazılır.
**Kullanıcı talimatı (2026-10-05):** bekleyen/devam eden her şey bitince servisi yeniden başlat ve canlıya al (= doğrulanmış `main`'i push et;
Vercel deploy'u push tetikler; migration uygulamak sahibin işidir).

## 5. Çalışma yöntemi (tekrar keşfetme)

- Çok ajan: `Agent` + `isolation:"worktree"`, dosya sahipliği çakışmasız; ajan yalnız commit eder, **push yapmaz**.
- Birleştirme: `git merge --no-ff worktree-agent-<id>`. Çatışma deseni: `ADMIN_CLIENT_INVENTORY.md` → `git checkout --ours`,
  commit; sonra izole klonda `npx tsx scripts/audit-admin-client.ts --write` ile yeniden üret ve ana depoya kopyala.
  Diğer çatışmalarda iki tarafı koru. CRLF/LF'i koru (betik: `\r\n` normalize et, yaz, geri çevir).
- **Doğrulama:** izole klon `scratchpad/verify` + `$TEMP/verify.sh` (git pull → npm ci → tsc → eslint → vitest
  `--testTimeout=120000` → check:links/cron/audit:actions → build, sahte env). Ana depodaki node_modules GÜVENİLİR DEĞİL.
  Push öncesi BUILD_EXIT=0 satırı GÖRÜLMEDEN push edilmez. Makine yoğunsa tek test zaman aşımı verebilir: tek başına koş.
- **Build kırıcılar (tsc/vitest yakalamaz):** `"use server"` dosyasından yalnız async export; istemci bileşeninde sunucu modülü
  (supabase/server, next/headers) import yok; `"use client"` ilk satır; bileşende `Date.now()/new Date()` yasak (clock.ts);
  `text-[Npx]` yasak; ham `<input type=tel|email>` yasak; PostgREST gömmeleri FK adıyla.
- **WORKTREE TABANI:** ajan worktree'leri yerel `main`'den DEĞİL `origin/main`'den (canlı commit) çıkar; yayınlanmamış işi görmezler. Her ajan prompt'una
  "ÖNCE `git merge --ff-only main` yap, sonra çalış" yazılmalı. Yapmayan ajan eski tabanda (ör. mega menü ajanı cf8ec63'te) çalışıp ana sayfa/fiyat
  okuyucu gibi sonradan yazılmış işi ezer; çatışma çıkarsa birleşimi iptal edip işi yazan ajana `SendMessage` ile "main'i merge et ve uzlaştır" de.
- Ajanların kendi ortamı build edemeyebilir (node_modules eksik) → birleşimden sonra izole klonda tam doğrulama ŞART.
- Aynı ajan raporunu tekrar tekrar gönderirse (arka plan çocuğu) `TaskStop` ile durdur; dalda `git log main..dal` boşsa yeni iş yoktur.

## 6. "Tek kaynak" haritası (yeni kod bunlardan beslenir, kopya yazılmaz)

| Konu | Tek kaynak |
|---|---|
| İl/ilçe/mahalle (YENİ, ajan yazıyor) | `src/lib/geo/**`, yönetim `/admin/geo` |
| Plan/fiyat/paket/deneme günü | `src/lib/billing/plan-definitions.ts` (+ `public-pricing.ts`, `plan-overrides.ts`); admin `/admin/billing/planlar` |
| Erişim kapsamı (kim neyi görür) | `src/lib/access-control/**` (saf: `scope-rules`, `admin-rules`, `query-scope`; sunucu: `scope-cache`, `list-scope`, `audit`); ofis bayrağı `office.access.scope_enforcement`; ekran `/app/ayarlar/yetkilendirme`; action `actions/access-control.ts` |
| Örnek veri | `src/lib/sample-scope.ts` (+ `sample-clear.ts`, `sample-data-seed.ts`); idempotent yükleme `src/lib/sample-data/seed.ts` (`ensureSampleData`), tek tuş silme `src/lib/sample-data/purge.ts` (RPC `purge_tenant_sample_data`, yoksa tablo-tablo), deneme/şerit `trial.ts` + `real-use.ts` (`REAL_USE_HREF`, owner/gm) |
| Danışman metriği/gelir | `src/lib/team/advisor-metrics.ts` (ofis brüt yalnız `earnings_all`) |
| Telefon | `src/lib/phone-rules.ts` (`parsePhoneStrict`), `PhoneInput` |
| Rol etiketi / terim | `src/lib/role-labels.ts`, `src/lib/terminology.ts` |
| Zaman | `src/lib/clock.ts` (TR ay sınırları `trMonth*`) |
| Tasarım token'ları (renk/lacivert/altın/boşluk/tipografi/gölge) | `src/app/tokens.css` (koyu: `theme-dark.css` ilk blok; hareket süreleri tek tanım `motion.css`); kılavuz `docs/DESIGN_SYSTEM.md` "Tasarım sistemi v4" |
| Panel bileşenleri (KPI, grafik kartı, ipucu, dikkat listesi, öneri, hero, segment, durum karosu) | `src/components/ui/{kpi-card,chart-frame,chart-tooltip,lazy-charts,attention-list,insight-card,dashboard-hero,segmented-control,status-tile}.tsx`; hareket `src/components/ui/motion/**` (motion yalnız LazyMotion+domAnimation+m); referans `/admin` |
| Platform metrikleri (aktivasyon, deneme→ücretli, ARPA, MRR tahmini, churn nedeni, modül benimseme, tüketim) | `src/lib/admin/platform-metrics.ts` (saf, testli; `/admin` ve `/admin/raporlar`) + `src/lib/admin/dashboard-layout.ts` |
| Menü | `src/lib/nav-config.ts` (9 başlık/42 öğe sözleşmesi; `description`/`keywords`/`advanced`/`shortcut` alanları, `NAV_SHORTCUTS`, `HIDDEN_APP_PAGES`, `MOBILE_TAB_SECTIONS`; ikonlar benzersiz `src/lib/icons.ts`; yetim sayfa testi `nav-pages-contract.test.ts`; tasarım `docs/design/MENU_IA_2026_10.md`) |
| Modül aç/kapa | `src/lib/modules/**` (registry, guard, pending-defs); tablo yokken hepsi açık |
| Onay kuralları | `src/lib/oversight/approval-gate.ts` (varsayılan kapalı, 48 sa tek kullanımlık; muafiyet yalnız owner/gm, `APPROVAL_EXEMPT_ROLES`; karar yetkisi `APPROVAL_DECIDER_ROLES`; tek mesaj `APPROVAL_PENDING_MESSAGE`) |
| AI | yalnız `src/lib/ai/openai-client.ts` + `redact.ts`; kredi `src/lib/ai/credits/**` |
| SEO | `src/lib/seo/**`, admin `/admin/seo`, sitemap/robots dinamik |
| Danışman kimlik şifreleme | `src/lib/advisor/pii-crypto.ts` (`ADVISOR_PII_KEY`; anahtar yoksa alanlar kapalı) |
| Havuz/atama puanı | `src/lib/pool/score.ts` (havuz sayfası sabit ağırlık); Ofis Merkezi akıllı atama `src/lib/office-center/smart-assign.ts` (bölge/uzmanlık alt hesabı score.ts'ten, ağırlıklar ofis ayarı `office.assign.weight_*`) |
| Ofis Merkezi (danışman yönetimi, akıllı atama, tanımlar) | `src/lib/office-center/**` (types, logic saf, smart-assign saf, definitions ⇄ registry eşlemesi, store/smart-assign-load sunucu), action `src/app/actions/office-center.ts`, sayfa `/app/ofis-merkezi?sekme=`; atama geçmişi tablosu `pool_assignments` (20261006000510) |
| Anket | `src/lib/surveys/**` (mevcut memnuniyet anketini genişletir) |
| Ürün turu | `src/lib/product-tour-data.ts` |
| Cron envanteri | `vercel.json` + `src/lib/cron-jobs.ts` (36 rota, `npm run check:cron`) |
| service_role | `src/lib/admin-client-allowlist.ts` (`audit-admin-client.ts --write`) |
| EmlakFiyati TEK ADAPTÖR (emlakfiyati.com'a TÜM çağrılar) | `src/lib/integrations/emlakfiyati/`: `adapter.ts` (tek `fetchExternal`; `emlakFiyatiGet(path, query)` tür-güvenli ince çekirdek, geri çekilme+jitter, en çok 4 eşzamanlı, bellek önbelleği, 401/403/429/5xx/ağ sınıflandırma, istek sayacı + `onEmlakFiyatiRequest` kancası [kontör ADAPTÖR DIŞINDA], 401 alarmı, `probeEmlakFiyatiConnection`), `policy.ts` (saf: izinli yol/başlık beyaz listesi, anahtar biçimi/maske, `X-Ortak-Kullanici-Ref` ve `Idempotency-Key` yardımcıları), `keys.ts` (anahtar çözümleme: admin şifreli > env `EMLAKFIYATI_API_KEY` yedek; rotasyon current/previous 7 gün), `ortak.ts` (ortak uç KAPISI + takma ref), `admin-status.ts`; şifreleme `src/lib/platform-secrets.ts` (`PLATFORM_SECRETS_KEY`, AES-256-GCM, `pii-crypto` kalıbı); admin ekranı `/admin/sistem?sekme=emlakfiyati` + `src/app/actions/platform-emlakfiyati.ts` (süper admin yazar, ops okur). Sözleşme testi: `single-adapter-contract.test.ts` |
| EmlakFiyati KONTÖR (tarife/paket/cüzdan/satış) | **Sözleşme** `src/lib/ef-credits/config.ts` (tarife+paket şemaları, RPC adları; DEĞİŞTİRİLMEZ). **Okuyucu** `credit-reader.ts` (ef_credit_ready yoklaması 60 sn, katalog [tag `ef-credit-config`], bakiye, geçmiş, son kontör faturası), saf görünüm `credit-view.ts`, admin `admin-data.ts` (ofis bakiye listesi, manuel yükleme RPC) + saf `admin-grant.ts` (doğrulama, ÖRNEK 4 paket ön ayarı). **Cüzdan/servis (wallet.ts, service.ts) BAŞKA AJANDA.** Satış: saf `src/lib/billing/credit-pack-purchase-core.ts` (KDV=invoiceAmountsTry, kontör başı, düşük bakiye eşiği, öneri), sunucu `credit-pack-purchase.ts` (fatura meta.kind=credit_pack), action `startCreditPackPurchase` (billing.ts). Ofis ekranı `/app/abonelik?sekme=kontor`; admin `/admin/ef-kontor` (süper admin yazar, ops okur, `updateTag`). Cüzdan hazır değilse (ef_credit_ready) HER ŞEY "etkin değil", para tahsil eden yol AÇILMAZ; kupon paketlerde KAPALI; demo ödeme yok. **SAHİP İŞLERİ:** paket fiyatları (katalog varsayılan BOŞ; admin"Örnek ön ayar" yalnız öneri) ve tarife değerleri (varsayılan EF_DEFAULT_TARIFF). Geçmiş okuyucusu defter sütunlarında hoşgörülüdür (kind/entry_type, units/amount, item/feature); cüzdan SQL canlıya girince gerçek sütun adlarıyla doğrulanmalı |
| TL hesap kredisi (try-credits) | `src/lib/try-credits/` (`config.ts` sözleşme + RPC adları, `wallet.ts` service_role RPC sarmalayıcıları [istemci ÇAĞIRANDAN gelir, kendi service_role'ünü yaratmaz], `reader.ts` ofis okuma, `checkout.ts`/`invoice-credit.ts` fatura payı, `view.ts` saf görünüm); ayar `platform_settings.try_credit.max_invoice_share`; fatura meta alanları `walletCreditTry`/`walletCashTry`/`paidWith` |
| Büyüme (referans/ortak) | `src/lib/growth/` (`engine.ts` RPC sarmalayıcı, `program.ts` saf, `store.ts` okuma, `settings.ts`, `attribution.ts`/`capture.ts` kayıt izi); SQL `20260826000600` (+`000800` seed, `001000` panel rol kapısı); ofis ekranı `/app/buyume` (yalnız owner/gm), admin `/admin/growth`; cron `growth-claims` |
| Muhasebe (admin) | `src/lib/accounting/` (`ledger.ts` saf fatura modeli, `csv.ts` muhasebeci CSV [Hesap Kredisi ile Ödenen kolonu], `loaders.ts` okuyucular [`loadTryLiability` kullanılmamış kredi yükümlülüğü], `ef-economics.ts`); ekranlar `/admin/muhasebe`, `/admin/muhasebe/defter`, CSV `/admin/muhasebe/disa-aktar` |
| Site içeriği | `src/lib/site-content/**`, admin `/admin/site-icerik` (public sayfa metinleri tek yerden) |
| EF kontör cüzdanı/servis | `src/lib/ef-credits/wallet.ts` (service_role RPC: rezerv/kesinleştir/bırak, rapor), `service.ts` (ortak uç çağrısı + kontör sırası), `plan-credits.ts` (aylık hak), `credit-reader.ts` (okuma) |
| Kayıtta örnek veri / kurulum sihirbazı | `/kayit` 6 adımlı sihirbaz (`src/app/kayit/register-form.tsx`); profil alanları/ayrıştırıcılar `src/lib/sample-data/office-profile.ts` (FIELD tek tanım), uygulama `apply-office-profile.ts` (signUp provizyondan SONRA, best-effort); demo set `src/lib/sample-registration-seed.ts` → `ensureSampleData` (paket = odak) |
| Ekip üyesi açma | `src/lib/team/provision-member.ts` (`provisionTeamMember`, koltuk/şube kapısı; `createTeamMember` ve sihirbaz daveti aynısını kullanır) |
| Birincil pazarlama CTA | `src/lib/marketing-copy.ts` `trialCtaLabel` ("Ofisini ücretsiz kur — N gün, kart gerekmez"), dar yerler `trialCtaShort`; otomatik görev sayısı `CRON_JOBS.length` (sabit sayı yazılmaz) |
| /app kabuğu tek tur verisi | `src/lib/app-shell/` (`bootstrap.ts` `loadShellBootstrap()` istek-içi cache + `bootstrap-core.ts` saf parse/kullanım/rozet); SQL `app_shell_bootstrap()` (20261006000400). İzin birleşimi TEK: `permissions-effective.mergeEffectivePermissions` |
| İstek-içi kimlik (profil + kendi tenant'ı) | `src/lib/cache/request.ts` `getRequestIdentity(userId)` TEK sorgu; `getRequestProfile`, `getTenantGateContext`, `getRequestSampleScope`, `tenant-guard` (requireActiveTenant/twoFactorSatisfied), `welcome-state` bundan okur. Yeni kod profil/tenant için ayrı sorgu YAZMAZ |
| Sunucu süre ölçümü | `src/lib/server-timing.ts` `measure(ad, fn)` (+ saf `server-timing-core.ts`); `EMLAKSOFT_SERVER_TIMING=1` iken `[server-timing] ad;dur=ms` log (Server Component başlık yazamadığı için başlık değil log) |
| "RPC henüz yok" yoklaması | `src/lib/supabase/rpc-probe.ts` (`rpcKnownMissing`/`recordRpcOutcome`, 60 sn; PGRST202/42883) — migration'dan önce yayınlanan RPC çağıran her kod bunu kullanır |
| Ana ekran anlık görüntüsü | `src/app/app/_home/data-batch.ts` (`loadDashboardSnapshot`, 3 RPC: 20261006000410) + saf `snapshot-core.ts`; yükleyiciler (`data.ts`, `insight-veri.ts`) önce buradan okur, yoksa mevcut sorgular |
| Ekran-altı erteleme | `src/components/ui/deferred-section.tsx` (IntersectionObserver; sunucu bileşenlerini children alır; veri çekimini ERTELEMEZ, yalnız istemci bağlamayı) |
| Piyasa endeksi (EmlakFiyati) | `src/lib/integrations/emlakfiyati/` (`contract.ts` saf: zod yanıt, slug yolu, tip eşlemesi `konut`/`arsa`; `client.ts` yalnız `adapter.ts` üzerinden: `getEndeks`, `getEndeksForPlace`, 12 sa `unstable_cache` + kısa negatif önbellek; 429'da Retry-After YOK, geri çekilme adaptörde); panel `src/components/app/emlakfiyati-endeks-panel.tsx`; değerleme kaynağı `src/lib/valuation.ts`. Endeksa ve TapuSor KALDIRILDI (kullanıcı kararı); eski `platform_settings` anahtarları (`endeksa_*`, `tapusor_*`) kodda okunmaz, temizlik migration'ı yazılmadı |

### 6b. EmlakFiyati: sahip işleri ve "ortak uçlar bekliyor" (2026-10-05)

**Sahip işleri:** (1) Vercel production'da `PLATFORM_SECRETS_KEY` tanımla (`openssl rand -hex 32`; kaybedilirse Admin'deki anahtar yeniden girilir) ·
(2) Admin > Sistem > EmlakFiyati'dan API anahtarını gir (env `EMLAKFIYATI_API_KEY` artık YEDEK; admin kaydı önceliklidir) ·
(3) "Bağlantıyı dene" ile doğrula · (4) anahtar rotasyonunda yeni anahtar girilir, eski 7 gün geçerli kalır (EmlakFiyati sözleşmesi).

**Ortak uç v1 KODU HAZIR (2026-10-05):** adaptörde `ortak-client.ts` + `ortak-contract.ts` (şema EmlakFiyati'nın kesin kılavuzuyla), `ORTAK_ENDPOINTS_VERIFIED = true` (kod sözleşmeye uyar);
kontör akışı `src/lib/ef-credits/service.ts` + `wallet.ts` (rezerv → çağrı → kesinleştir/bırak; `ef-kontor-sweep` cron artıkları temizler). Bayrak (`ortakGate`) varsayılan KAPALI: uçlar
EmlakFiyati tarafında CANLI olduğu doğrulanınca süper admin açar ("Bağlantıyı dene" probe'u). Zorunlu başlıklar: `X-Ortak-Kullanici-Ref` (takma ref, 8-64 karakter) + `Idempotency-Key`.
Kontör EmlakSoft'ta düşer, mutabakat için EmlakFiyati aylık kullanım dökümü verir (mutabakat adaptörü hâlâ yok).
**Hâlâ ŞEMA GEREKLİ (EmlakFiyati'ndan, tahmin edilmedi; ortak uç dışındakiler):** `/api/ara`, `/api/grafik/seri|iller|genel`, `/api/dashboard`, `/api/rayic`, `/api/resmi-duyurular`, `/api/parsel*` (mahalle, ornekler, kademe), `/api/konut-kapsama`, `/api/disa-aktar`, `/api/ilanlar`
için sorgu parametreleri ve yanıt şemaları (adaptör yalnız `get(path, query)` çekirdeği sunar; yalnız `/api/endeks` path+tip doğrulandı). `/api/parsel/rapor?format=pdf` kullanıcı ürününde KULLANILMAZ.
`docs/design/EMLAKFIYATI_KONTOR_MIMARISI.md` §5 (HMAC imza başlıkları `X-ES-*`) EmlakFiyati'nın bildirdiği sözleşmeyle UYUŞMUYOR (Bearer + `X-Ortak-Kullanici-Ref` + `Idempotency-Key`); kontör kodu yazılmadan önce o belge güncellenmeli.

**EF tek durum kaynağı (WP1):** `src/lib/ef-credits/public-state.ts` (`getEfPublicState()` -> `{state: live|soon|stale|maintenance, live, purchasable}`;
saf karar `public-state-core.ts`). live = anahtar + bayrak + 7 günden taze probe damgası + `ef_credit_ready`. Kontör satın alma
(`startCreditPackPurchase`) ve kontör sekmesi yalnız `purchasable` iken açılır; public fiyat yüzeyleri live değilse "(planlanan)" der.
Günlük `ef-kontor-saglik` cron'u damgayı yeniler/siler.

## 7. Kararlar (değişmez, tekrar sorulmaz)

- Yanıtlar Türkçe. Popup yok, sekme/panel. Kararları sormadan ver (sert güvenlik hariç: zorunlu 2FA/TOTP vb. onaysız eklenmez;
  `PLATFORM_MFA_ENFORCEMENT=on` yayın öncesi açılacak, şu an kapalı). Özet panelinde maskeleme yok.
- Fiyat kataloğu (kullanıcı onaylı): Danışman 749 · Ofis 2.490 (ek kullanıcı 399) · Profesyonel 4.990 (15 kullanıcı, ek 349) ·
  Business 8.990 (varsayılan gizli) · Kurumsal 12.900 (50 kullanıcı dahil, ek 249/199/149 kademeli, en fazla 500; "özel teklif" YOK, `customPricing` alanı kaldırıldı); yıllık "10 öde 12"; ücretsiz paket YOK; deneme süresi tek kaynak
  (`getEffectiveTrialDays`; `platform_settings.default_trial_days`, yoksa **14 gün**); Founders kampanyası admin düzenlenebilir; ödül/ortak oranları kodda sabit DEĞİL.
- Aylık kontör hakkı (`efCreditsMonthly`): Danışman 10 · Ofis 40 · Profesyonel 120 · Business 240 (gizli) · Kurumsal 400 + ek kullanıcı başı Danışman 5 · Ofis 6 · Profesyonel 6 · Kurumsal 6 (WP3; plan kontörü paket birim fiyatıyla değerlenince fiyatın %11–%22'si; canlı kayıt migration 20260826001100, PB17; `efCreditsPerExtraSeat`, cron `ef-kontor-hak` `subscriptions.extra_seats` ile ölçekler; sütun yoksa 0). Ek rapor paketi = admin kontör kataloğu (`ef.packs`), ofiste Abonelik > Kontör; ana sayfada `EmlakFiyatiSection`.
- Demo veri public vitrine/portal/sitemap'e sızmaz; demo danışman hesabı AÇILMAZ (auth.users bağı); tüm demo kayıtlar kurucuya atanır.
- Onay kuralı muafiyeti owner/gm ile sınırlanmalı (denetim 3, #5); ofis kapatma veri paketi yalnız platformun `completed` yaptığı talepte.
- Anketör rol değil, atanabilir görevdir. Tetikleyiciler kapalı doğar, geriye dönük anket üretilmez.
- Ofis kapatma = arşivleme (veri SİLİNMEZ); sahibe CSV veri paketi (ZIP yok).
- Kimlik/vergi no ilan sahibi tablosunda tutulmaz (veri minimizasyonu).

## 8. Sahip kararları / işleri (özet)

Karar (2026-10-06): avukat onayı aşaması kaldırıldı; hukuki metinlerin sorumluluğu ofis/şirket sahibindedir (kodda/belgede 'avukat onayı bekliyor' işareti tutulmaz).

Migration uygulama (sıra §2) · `git push` (§1) · `ADVISOR_PII_KEY` üretimi (`openssl rand -hex 32`, kaybedilirse TC/IBAN geri gelmez) ·
Supabase redirect allowlist'e `/app/hesabim?eposta=onay` · fiyat/DB tutarı kararı (§3) · Google Search Console'a sitemap ekleme ·
yayın öncesi güvenlik (MFA bayrağı, demo kartlarını kapat, anahtar rotasyonu, yedek/PITR) · TÜFE/kredi faizi/harç doğrulaması ·
ödül/ortak programı oranları · KVKK açık rıza metni ("tanıtım amacıyla", `src/lib/legal-copy.ts`; asıl amaç talebe dönüş) · **Vercel production env `EMLAKFIYATI_API_KEY` tanımla** (sunucu sırrı; yoksa piyasa endeksi "bağlantı yok" görünür) · canlı QA (mobil form çubuğu, menü yoğunluğu, pano sürükle-bırak, ofis açma, yeni TV/tur/sihirbaz).

## 9. Belge dizini (nerede ne var)

`docs/design/BIRLESIK_YOL_HARITASI.md` (yol haritası, terim sözlüğü, 15 çelişki kararı) · `ONERI_LISTESI_KARSILASTIRMA.md` (113 madde) ·
`ISLEM_TAMLIK_DENETIMI.md` · `DANISMAN_UZMANLIK_HAVUZ_DEMO_SPEC.md` · `PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` (F1-F5) ·
`OZELLIK_ARASTIRMASI_2026_10.md` (2026-10-06: piyasa+mevzuat taraması, VAR/KISMEN/YOK, ilk 10; en zamana duyarlı: Güvenli Ödeme Sistemi zorunluluğu 1 Aralık 2026 + EİDS taşınmaz kimlik no; uygulanmadı, yalnız öneri) ·
`ORGANIK_BUYUME_PLANI.md` · `REFERANS_PROGRAMI.md` · `BILLING_PAUSE_PRORATION_DESIGN.md` · `OFIS_SAHIPLIGI_DEVRI.md` · `GUVENLIK_DENETIMI_3.md` ·
`docs/DURUM.md`, `MIMARI.md`, `ROADMAP.md`, `DEPLOY.md`, `DESIGN_SYSTEM.md` · `docs/security/` (admin client envanteri) ·
`.claude/agents/` (birlestirme, canli-qa, guvenlik, hiz, migration ajanları).

## 10. Kayıtlı kart (iyzico kart saklama) — 2026-10-05, CANLIDA UYGULANDI (000700)

Kart BİZDE değil iyzico'da. Migration `20260826000700_payment_cards.sql` (+rollback) `payment_cards` + `tenant_payment_profiles` + `set_default_payment_card` (PB9, uygulanmadı;
tablolar yokken kod zarifçe kapalı). Ofis düzeyi kapsam (owner/gm yönetir). Ekleme: ödeme ekranında varsayılan KAPALI "Kartımı sakla" (fatura meta `saveCard`), callback doğrulama
zincirinden SONRA `saveCardFromPayment`. Liste/varsayılan/sil: `/app/abonelik` + `src/app/actions/payment-cards.ts`; sil iyzico'dan da siler (`card-store.ts`). Kayıtlı kartla ödeme =
Checkout Form'a `cardUserKey` verilir (iyzico sayfası kartı listeler; 3DS iyzico'da). Otomatik yenileme altyapısı `auto-renew.ts` (dunning cron içinde) `platform_settings`
`billing.auto_renew_enabled`="true" olmadan ÇALIŞMAZ + ofis rızası şart. PCI sözleşme testi `pci-card-data-contract.test.ts`. Açık doğrulamalar: CF retrieve yanıtında
`cardUserKey/cardToken` dönüşü, off-session `/payment/auth` için iyzico satıcı onayı (sandbox/hesap gerekir).

## 11. Varsayılan program ayarları seed (20260826000800) — 2026-10-05, CANLIDA UYGULANDI

Tek, idempotent VERİ migration`ı `20260826000800_default_program_settings.sql` (+rollback, PB13): referans kuralı (`monthly_multiple` 1 aylık bedel, hold 30 gün, kredi 365 gün, tek seferlik), program ayarları (3.→+0,5 ay Gümüş Elçi, 10.→+2 ay Altın Elçi, yıllık tavan 12, hız 5/gün, nakit oranı 0,50, ilk 3 manuel), hoş geldin kredisi 300 TL (fatura payı %50 sınırının altında), `growth_referral_enabled=on` (ortak/nakit/oto-yenileme KAPALI, `platform.mfa_enforced`a dokunulmaz), `billing.plan_definitions` = RECOMMENDED_CATALOG_OVERRIDES kaydı (customPricing temizliği, Profesyonel plan_entitlements 20→15), `ef.tariff` ve 4 kontör paketi. Admin değeri varsa korunur. DOĞRULANMADI (test/lint/build koşulmadı).

Uygulandı (2026-10-05). Release çifti (`RELEASE_MIGRATION` + `_CHECKSUM`) DB'de uygulanmış SON migration'a çekilir (`npm run check:migrations -- --release` çıktısı; bkz. DEPLOY.md).

## 12. Büyüme motoru güvenlik hotfix'i (20260826000900) — 2026-10-05, CANLI DB'YE UYGULAMA BEKLİYOR (PB14)

Bağımsız güvenlik denetimi bulguları (program canlıda AÇIK; 000600/000800 uygulanmış, dosyalara dokunulmadı). Yeni `20260826000900_growth_hotfix.sql`
(+ `rollbacks/20260826000900_growth_hotfix.rollback.sql`: 9 orijinal gövde birebir + yeni yardımcıları düşürme; PB14, `scripts/migration-pairs-data.ts`).
Yalnız `CREATE OR REPLACE` (md5 korumalı ön-koşul: taban VEYA kendi sürümü; sapmada durur) + seed kural satırı; şema/bayrak değişmez.
- **B1** ilk-N sayacı yalnız personelce onaylı talepleri sayar · **B2** onaylı talep de eligible_at + davet edilen aktif/yenileme kapısından geçer ·
  **B3** hoş geldin kredisi kayıtta DEĞİL ilk gerçek ödemede (ödeme yapan aktif davetçi + yeni müşteri; `growth_welcome_apply`) · **ekonomi** ödül = davet edilenin
  >=1 gerçek yenilemesi (ilk ödemeden >=20 gün sonra) + hâlâ aktif + hold 45 gün; seed kuralı (dokunulmamışsa) hold 45, aylık tavan 5000 ·
  **B5** `meta.chargeback` = gerçek ödeme değil; admin "Ters ibraz kaydı düş" (`recordInvoiceChargeback`) + iyzico webhook (chargeback/dispute olay adı) talepleri geri alır ·
  **B9** kademe bonusu yalnız aktif + >=2 ödemeli davetleri sayar, taban geri alınınca eşik altı bonus geri alınır · **B10** `low_cash_ratio` yerine `credit_used` bayrağı
  (min_cash_ratio ayarı artık kullanılmaz) · **B11** tarama: A yalnız ilk-ödeme adayları, C hazır olmayanları sorguda eler + updated_at ile döner sıra ·
  **B12** ofis panosu TL yalnız owner/gm (`money_visible`) · **B16** davet önizleme: 8 karakter kod, yalnız aktif+ödeyen davetçi, kayıt sayfasında IP hız sınırı ·
  **B15** iade kredisi idem anahtarı fatura + önceki geri yazım (fark tamamlanır) · **B4** otomatik yenilemede belirsiz hata = fatura 'initialized' kalır (yalnız kesin ret
  'initialization_failed'; çift çekim yok; çözülmemiş 'initialized' sonraki denemeyi engeller, mutabakat/yönetici çözer; bayrak KAPALI) · **B6** MFA env + DB ayarı tutarsızlık şeridi
  + DEPLOY.md zorunlu adım (zorunlu MFA AÇILMADI).
- **B13 (yalnız belge):** `20260826000800` rollback'i seed ÖNCESİ değerleri bilmez: `updated_by IS NULL` olan platform_settings satırlarını SİLER (seed'den önce SQL ile elle yazılmış
  değerler de gider), `growth_referral_enabled`'ı 'off' yapar, welcome 300->0 sıfırlar, plan_entitlements 15->20 döndürür. Rollback ÖNCESİ ilgili anahtarların değerlerini kaydedin (`select key, value, updated_by from platform_settings where key in (...)`).
- **B7 (yalnız belge):** seed `ef.packs`'ı '[]' ya da boşsa yazar (admin bilerek boş bırakıp paketleri kapattıysa ezilir) ve `growth_referral_enabled=on`'u /admin/growth hazırlık
  kontrolünü ATLAYARAK yazdı (kontrol yalnız `saveGrowthFlags` yolunda). Seed uygulandı; geri alma yok; hotfix'te düzeltme gerekmedi.
- **Test borcu:** `growth-engine-sql-exec.test.ts` (pglite) yalnız 000600'ü yükler; hotfix davranışları (hold/yenileme, welcome ilk ödemede, low_cash_ratio→credit_used, B1 sayaç)
  için güncellenmeli/ genişletilmeli. Statik sözleşme: `growth-hotfix-contract.test.ts`. DOĞRULANMADI (test/tsc/lint/build koşulmadı).

## 13. Zeka katmanı (Insight Engine) temeli — 2026-10-06, CANLIDA (migration'lar uygulandı; birleştirme sonrası tam kapı turu yeşil)

> Güncel durum (2026-10-06): 002000–002070 (ilan kontrol) ve 002500–002700 (Insight) canlı DB'de, release çifti `20260826002700_insight_support.sql` / `a19c2b4453e9b4ee`. Pencere numaraları: ayar defteri PB25–28, ilan kontrol PB29–31, Insight **PB32** (order 29.83), P12 en sonda. Aşağıdaki "PB30" ve "uygulanmadı" ifadeleri tarihsel. Cron sayısı 36.

- **Migration (artık uygulandı):** `20260826002500_insights.sql` (insights tablosu: href NOT NULL, `unique (tenant_id, recipient_user_id, dedupe_key)`, `sample_scope` CHECK false, RLS alıcı kendi + owner/gm ofis, yazma yalnız service_role, `insight_set_state` RPC) ·
  `20260826002600_platform_insights.sql` (platform personeli ikizi) · `20260826002700_insight_support.sql` (service_role olgu RPC'leri, `insight_rule_quality` görünümü, `insight_housekeeping`). Pencere `PB30-icgoru-temeli` (order 29.81, P12'den önce). Rollback dosyaları var. Kod migration yokken boş dizi / "etkin değil" ile düşer (hata vermez).
- **Kod:** `src/lib/insights/**` (types, priority, dedupe, quality, settings, facts, store, engine, readable, **read.ts = ana ekran okuyucusu** `getInsightsForUser({tenantId,userId,role,limit}) => Insight[]` + `countInsightsByState`), kurallar `rules/*` (`call-priority`, `deal-risk`, `price-action`, `deadline`, `anomaly`, `digest`; kayıt listesi `rules/index.ts`, sonraki paketler yalnız kendi satırını ekler), action `src/app/actions/insights.ts` (`setInsightState`, `acceptInsightAsTask`, `saveInsightSettings`), cron `insight-engine` (36. cron; service_role `runBillingReconciliation(0, "insight_engine")` kapalı iş seçicisinden, allowlist'e satır EKLENMEDİ), LLM `src/lib/ai/insight-narrative.ts` (varsayılan KAPALI, ofis ayarı `oversight_settings.thresholds.insights`), kapılar `src/lib/ai/auto-call-gate.ts` + `narrative-guard.ts`.
- **Dürüstlük kuralları kodda:** emsal yoksa fiyat içgörüsü yok; anomali min 8 hafta + min hacim + yalnız bilgi düzeyi; tahmin etiketli içgörüler `is_forecast`; örnek veri ofisi atlanır; yoksay "ilgisiz/yanlış" 30 gün bastırır; yanlış alarm oranı > %40 (min 10 değerlendirme) kuralı sessize alır; içgörü hiçbir kaydı kendi başına değiştirmez.
- **P0:** brifing LLM çağrısı artık `audit` ZORUNLU + günlük süreç içi önbellek + kota kapısı + sayı doğrulaması (`briefing-audit-contract.test.ts`); `price-health` kaynak etiketi (`source`/`confidence`, referans modeli = düşük güven; `resolvePriceHealthWithSource`); `office-score-breakdown.ts` bileşen kırılımı (sabit 42 "taban" olarak etiketli).
- **Sonraki ajan (ana ekran):** `page.tsx` + `_home/**` YENİDEN TASARLANACAK; `bugun-ozet.tsx`'te yalnız brifing çağrısına audit eklendi. Okuyucuyu oradan çağırın; `hero`/şerit tasarımı planda (D1).

## 14. Geliştirme borcu kapatma turu (takım modeli, tanım merkezi bağları, platform içgörüleri) — 2026-10-06, DOGRULANMADI

- **Migration `20260826002900_takim_teams.sql` (+rollback, PB34, order 29.85; CANLIDA UYGULANMADI):** `teams` (ofis/şube bağlı, lider = profiles.id, RLS: ofis okur, owner/gm/branch_manager yazar), `profiles.team_id` (+ofis/yetki tutarlılık tetikleyicisi), `properties.assigned_at` (assigned_to değişince now()). `lc_current_team_id/lc_row_visible` team_id'yi dinamik okuduğundan takım lideri kapsamı kolon gelince canlanır.
- **SLA takım lideri:** `listing-control/server/escalate.ts` `resolveTeamLeads` (profiles.team_id → teams.lead_user_id; şema yoksa boş = eski davranış). `sync.ts` atama zamanını önce `properties.assigned_at`'tan okur. Takımlar ekranı: `/app/ekip/takimlar` (nav sekmesi "Takımlar", `actions/teams.ts`, saf doğrulayıcı `lib/team/team-input.ts`).
- **Ofis tanımı bağları:** yeni ayarlar `office.commission.default_rate` (calculateCommission `defaultRate`, estimateLostCommission, anomali kartı), `office.insight.customer_quiet_days|listing_stale_days|dormant_days`; içgörü kuralları `office.alert.deal_stale_days` + bunları `rules/index.ts insightThresholds` ile okur; cron/service_role için `lib/settings/tenant-read.ts readTenantSettings(db, tenantId, keys)` (çağıranın istemcisi, açık tenant_id). Günlük/haftalık özet cron'ları `digest-prefs.ts wantsDigest(prefs, officeDefault)` ile ofis varsayılanını okur.
- **İlan Kontrol rapor teslimi:** `office.listing_control.report_daily|report_weekly` (varsayılan KAPALI) → gunluk-ozet/haftalik-ozet cron'larına eklenen `report-delivery.ts` (zil bildirimi, owner/gm, dedupe `lc-report:<dönem>:<ofis>:<anahtar>:<kullanıcı>`). E-POSTA kanalı YOK (depoda işlemsel e-posta sağlayıcısı bulunmuyor).
- **Platform içgörü üreticisi:** `insights/rules/platform.ts` (saf kurallar) + `insights/platform-engine.ts`; `runBillingReconciliation(0, "platform_insights")` kapalı iş seçicisi, insight-engine cron'unda ek adım (allowlist satırı eklenmedi). Kurallar: ödeme başarısızlığı artışı, EF mutabakat sapması, hata veren cron, riskli ofis (past_due), deneme bitimi + etkileşimsiz (TAHMİN etiketli).
- **Tutarlılık:** `list-page-contract` KNOWN_DEBT 13 → 0 (sayfalar `batchAll`/`assertQueryBatchSucceeded`); `gorev-hatirlat` sabit `.limit(300)` kalktı (vade sıralı sayfalama, tavan heartbeat'te açık); kira yenileme radarı (kiralama sayfası + kira-tahakkuk cron) TÜFE'yi yönetim tablosundan (`loadTufeTable` + `computeLegalIncreaseIn`) okur.
- **AI asistan SSS:** `ai/faq-context.ts` (saf seçici; eşleşme yoksa ekleme yok, fiyatlı kayıt beslenmez) → `ai-tenant-advisor.ts` sistem bağlamı + yapay zekasız yedek yanıt.

## 15. H2 / H3 / H6 (Ekim 2026 özellik araştırması) — 2026-10-06, KODDA; migration'lar CANLIYA UYGULANMADI (PB37-PB39)

- **Migration (uygulanmadı, sahibi `--only` ile uygular, backup/PITR sonrası):** `20260826002950_property_eids_no.sql` (PB37, order 29.88: `properties.eids_property_no` nullable + `^[A-Z0-9-]{6,24}$` CHECK + kısmi indeks) ·
  `20260826002960_rent_reminders.sql` (PB38, 29.89: `rent_reminder_settings` KAPALI doğar, yazma yalnız owner/gm/branch_manager · `rent_reminders` dedupe `unique(rental_id,period,kind,channel)` · `customers.rent_reminder_opt_out`) ·
  `20260826002970_contract_rental_link.sql` (PB39, 29.90: `contracts.rental_id` composite FK `on delete set null (rental_id)`, `rent_increase_basis`, `rent_increase_fixed_pct`). Hepsi forward-only + rollback, P12'den önce. Kod üçünde de sütun/tablo yokken zarifçe düşer (ayrı hataya dayanıklı okuma).
- **H2 EİDS:** saf mantık `src/lib/eids/**` (`property-no.ts` normalize/doğrulama — resmî biçim DOĞRULANAMADI, gevşek kalıp; `authority-term.ts` 3 ay kuralı + 15/7/3 gün; `status.ts` Uyum/portföy süzgeci tek kaynağı; `health.ts` skor bileşeni; `load.ts`). Form alanı: yeni portföy "İlan sahibi" sekmesi + portföy detay "Yetki belgesi" paneli. Sağlık skoru `eids` bileşeni hem `engine.ts`/`sync.ts` (depolanan) hem `lifecycle-model.ts`/`readers.ts` (canlı) tarafında ölçülür; sütun okunamazsa "ölçülemedi". `authority-shield.ts` yumuşak `notes` döner (engellemez); `createPipelineDeal` müzakere/kazanıldı aşamasında ofise tek seferlik bildirim yazar. Uyum merkezi "EİDS ve yetki durumu" bölümü her sayaçtan `/app/portfoyler?yetki=<eids_eksik|yetki_eksik|kisa|bitiyor|dolmus>` süzgecine gider.
- **H3 kiracı hatırlatma:** saf mantık `src/lib/rent-reminders/logic.ts`, çalıştırıcı `run.ts` (admin istemci PARAMETRE; allowlist'e satır eklenmedi), `kira-tahakkuk` cron'unun 4. adımı (36 cron sabit). KAPALI doğar; kanal 1 ofise bildirim + kiralama "Hatırlatma" sekmesinde wa.me tek tık; kanal 2 SMS yalnız `sms_enabled` + ofisin kendi Netgsm'i + TR cep (`parsePhoneStrict`) + sessiz saat dışı + kiracı başına 20 saatte 1 + ofis başına çalıştırmada 100. Kiracı opt-out iki kanalı da keser. Ayar kartı `/app/kiralama` (id `hatirlatma-ayarlari`). SMS'in işlem iletisi mi ticari ileti mi olduğu (İYS) SAHİP SORUMLULUĞUNDADIR; ayar kapalı doğar.
- **H6 kiralamadan sözleşme:** `src/lib/rental-contract/build.ts` (taslak gövde, TÜFE/sabit/yok artış maddesi, ofis şablonu `{kiraci}`… alan doldurma), `sozlesmeler/yeni?tur=kira&kira=<id>` (`rental-context.ts` salt-okunur ön dolgu), `createContract` `rental_id` + artış alanı, iki yönlü bağ: kiralama "Sözleşme" sekmesi + header butonu ↔ sözleşme sayfasında "Kira kaydı" chip'i. Metin yer tutucudur; hukuki/nitelikli e-imza iddiası yok.

## 16. Ofis Merkezi modülü (office_center) — 2026-10-06, CANLIDA (PB43 000500+000510 uygulandı 2026-10-06)

- **Migration (uygulanmadı; sahibi `--only` ile, sıra: 000500 → 000510):** `20261006000500_office_center_permission_defaults.sql` (4. kayıt noktası: owner/gm ALL, branch_manager view+edit,
  team_lead view; `permissions.ts` DEFAULT_MATRIX ile birebir — readonly'den office_center KALDIRILDI) → `20261006000510_pool_assignments.sql` (atama geçmişi: method manual|smart|rule,
  score jsonb kişisel verisiz, status active|cancelled|reassigned, ilan başına tek aktif satır; RLS okuma office_center view VEYA atanan kişi, yazma office_center edit; DELETE yok). Rollback'ler var; pencere `PB43-ofis-merkezi` (order 29.94).
  Kod tablo yokken atamayı yine yapar (ilan + bildirim) ve "geçmiş etkin değil" uyarısı verir.
- **Sayfa `/app/ofis-merkezi?sekme=danismanlar|atamalar|ayarlar|tanimlamalar|istatistikler`** (URL filtre kontratı: `durum`, `q`, `rol`, `sube`, `sirala`, `yon`, `grup`, `ayar`). Danışmanlar: liste (açık portföy/talep, bu ay kazanılan, SLA uyumu,
  son aktivite = çağrı/iletişim/portföy kaydı 90 gün; her sayı filtreli hedefe gider), satırdan rol/şube/takım, pasife alma (+ iş yükü devri `handoffMemberWorkload`), hızlı davet (`createAdvisor` akışı; tam form `/app/ekip/yeni`).
  Atamalar: danışmansız ilanlar (havuz kaydı varsa `assign_pool_entry` RPC ile atomik), "Akıllı öner" → 3 kart gerekçeli → tek tık ata, elle ata, geçmiş/iptal/yeniden ata; şube müdürü yalnız kendi şubesi.
  Ayarlar: `SettingField` (merkez ile aynı bileşen/eylemler, geçmiş+geri alma) + modül kısa yolu (`setModuleEnabled`). Tanımlamalar: SLA/komisyon/eşik/ağırlık/bildirim formları → aynı registry anahtarları (yazım `writeSetting`, kapı `settings:edit`).
  İstatistikler: gerçek sayımlar, danışman ligi `advisor-metrics` (kazanç yalnız `earnings_all`), ekip sağlığı eşikleri ofis ayarından.
- **Yeni ofis ayarları (registry/tenant.ts, grup `atama` + `esik`):** `office.assign.weight_workload|specialty|region|performance|availability` (25/20/25/15/15, motor oransal normalize eder), `office.assign.unassigned_sla_hours` (24), `office.alert.unassigned_pool_count` (5).
  Yeni `OFFICE_SETTING_GROUPS` girişi `atama`. Ayrıca `src/lib/pool/score.ts` `regionPoints`/`specialtyReasons` dışa açıldı (tek hesap).
- **service_role YOK** (iskeletteki 10 `createAdminClient` kaldırıldı); audit:actions temiz. Bildirim `notifyTenant` dedupe `oc-assign:<id>` / `oc-cancel:<id>` (sütun yoksa anahtarsız tek deneme).
- **Kabul edilen örtüşme:** Ayarlar sekmesi (tek anahtar düzenleme + geçmiş) ile Tanımlamalar (gruplu form) aynı anahtarlara yazar; iki ekran ama tek depo. Sadeleştirme isterseniz Tanımlamalar kaldırılabilir.
- **Test edilemeyen:** gerçek DB'de RLS/RPC akışı, tarayıcıda sekme/panel davranışı. DOGRULANDI: tsc, eslint (dokunulan), vitest tam tur, check:links/cron/migrations/migration-pairs, audit:actions, build (rapor).

## 17. Yetkilendirme ekranı + kapsam uygulaması (kurumsal erişim kontrolü) — 2026-10-06, KODDA; 000100-103 CANLIDA, migration 000104 CANLIYA UYGULANMADI (PB40 kuyruğu)

- **Yeni migration (PB40, 000100-103 ile AYNI pencere, onlardan SONRA):** `20261006000104_access_control_write_policies.sql` (+rollback) — `access_audit_log` INSERT politikası (tenant eşitliği + `created_by = auth.uid()` + owner/gm/branch_manager) + `grant insert`. 000102 yalnız SELECT veriyordu; server action'lar kullanıcı istemcisiyle günlük yazamıyordu. Uygulanmazsa yetkilendirme yazmaları "denetim kaydı yazılamadı" diyerek GERİ ALINIR (kayıtsız yetki değişikliği yok).
- **Ekran `/app/ayarlar/yetkilendirme`** (kapı `settings`; ayrı `roles` modülü YOK, roller ekranıyla aynı; yazma yalnız owner/gm). Sekmeler `?sekme=`: `kapsamlar` (ofis bayrağı + satır içi kapsam düzenleme), `istisnalar` (scope_overrides: arama ile kaynak seçimi, gerekçe zorunlu, varsayılan 30 gün, iptal = expires_at=now, süresi geçen soluk), `izinler` (kişi bazlı `user_permission_overrides` matrisi — roller ekranından BURAYA TAŞINDI; `/app/ayarlar/roller?tab=istisnalar[&user=]` yönlendirir), `gunluk` (`access_audit_log`, URL filtre kontratı `kullanici|yapan|tur|from|to|sayfa`, gerçek sayfalama, CSV aynı süzgeçle). Menü: Ayarlar öğesinin sekmesi (`ICONS.yetkilendirme` = UserCog); Ayarlar kartı eklendi.
- **Kapsam uygulaması = OFİS BAYRAĞI, varsayılan KAPALI:** `office.access.scope_enforcement` (tenant ayarı, grup `erisim`, risk high → gerekçe zorunlu; Tanımlar Merkezi'nde de görünür). KAPALI = bugünkü davranış birebir. AÇIK = `getListScope` (`src/lib/access-control/list-scope.ts`) kullanıcı kapsamını (user → `assigned_to=self`, team/branch → `in(üyeler+self)`, office/platform → süzgeç yok) talep (customer.assigned_to, `!inner`), müşteri (+KPI sayıları), portföy (+KPI), anlaşma, görev LİSTE sayfalarına ve `exportCustomersCsv/Properties/Demands/Deals`'a uygular. **Kapsam yalnız DARALTIR**: eski rol kuralı (`hasOfficeWideDataScope`, anlaşmalar `officeWide`) `tightenScopeFilter` ile taban kalır. Rozet `ScopeBadge` ("Kapsam: Takım (Satış A)") yalnız daraltma varken çizilir, yetkilendirme ekranına gider. Takım/şube üyesi yoksa fail-closed self.
- **Saf kurallar (vitest):** `admin-rules.ts` (`canChangeScope`: yalnız owner/gm; kendini değiştiremez; owner kapsamını yalnız owner; owner/gm office altına inmez; platform atanmaz; team/branch bağlam zorunlu; `can_view_all_data` yalnız office — `canCreateOverride`: gerekçe ≥5, uuid kaynak, izin süresiz olamaz/≤365 gün, kendine/ofis sahibine yazılamaz — `canEditPermissionOverride`: kendine izin istisnası yazamaz [eski açık kapandı]), `query-scope.ts`, `audit-filters.ts`. `scope-cache.getUserScope` artık `user_scopes` satırını okur, yoksa `defaultUserScopeForRole`; owner/gm tabanı office. `SCOPE_RESOURCE_TABLES`: `demand` → `customer_demands` (şemada `demands` tablosu YOK; talep sahipliği `customers.assigned_to`).
- **Action'lar `src/app/actions/access-control.ts`:** `upsertUserScope`, `resetUserScope`, `createScopeOverride`, `cancelScopeOverride`, `searchScopeResources`, `listAccessAudit`, `exportAccessAuditCsv` — Zod, tenant eşitliği (hedef profil + takım/şube + kaynak aynı ofis), her yazma önce/sonra ile `access_audit_log`; denetim yazılamazsa telafi (geri al). `actions/permissions.ts` istisnalar da `permission_granted/revoked` yazar (tablo yoksa ana işlemi bozmaz). Yalnız DEĞİŞİKLİK yazılır; aktif kapsam izi/okuma yazılmaz.
- **Rol değişimi:** `updateTeamMember` rol değişince `syncScopeForRoleChange(admin, …)` ile kapsam satırını rol varsayılanına çeker (+günlük, `source: role_change`; şema yoksa atlar). Süresi 90+ gün önce dolan istisnalar `operational-retention` cron'unun adımı `purgeExpiredScopeOverrides` ile silinir (YENİ cron yok; allowlist satırı değişmedi).
- **Bilinen/sahip:** (1) `has_permission_with_scope` RPC `customer_demands`/`customers.assigned_to` ile düzeltildi (main, canlıda). (2) `/api/export/[entity]` tam akış dışa aktarma ve ana ekran `scopeMine` hâlâ yalnız eski rol kuralı (kapsam bağlanmadı; sonraki adım). (3) Bayrağı AÇMA kararı sahibin: açınca danışman yalnız kendi müşteri/portföyünü görür (bugün tüm ofisi görüyor). (4) Pre-existing kırmızılar (bu işten değil): `nav-config.test` ikon çakışması "Ofis Merkezi"/"Ayarlar" (ikisi `ICONS.ayar`), `admin-client-tenant-contract` office-center.ts için allowlist satırı yok (Ofis Merkezi ajanı).

## 18. Menü bilgi mimarisi düzeni — 2026-10-06 (main'e birleşti)

- **Tek kaynak genişledi (`src/lib/nav-config.ts`):** 9 başlık korunur (id'ler sabit), 42 öğe. Yeni alanlar `description` (zorunlu; palet satırı + menü ipucu),
  `keywords` (yalnız arama eş anlamlısı; "lead" yalnız Talepler), `advanced` (yan menüde "İleri düzey" ayracının altı), `shortcut` (`g m`…; `NAV_SHORTCUTS`
  → `keyboard-shortcuts.tsx` GIT listesi ve palet rozeti). `HIDDEN_APP_PAGES` (8 gerekçeli gizli sayfa) + `nav-pages-contract.test.ts` (her statik page.tsx
  menüde / üst öğe altında / gizli listede). `MOBILE_TAB_SECTIONS` alt çubuk (Bugün, Müşteriler, Portföy, Anlaşmalar + Daha fazla; "Yeni" FAB kaldırıldı,
  hızlı kayıt üst çubuk Yeni menüsünde ve `n h`).
- **Taşımalar:** Randevular+Görevler → Bugün; AI Asistan → Araçlar; Ofis kurulumu → Ofis; Bildirimler/İçe aktarma/Mahalle notları menüye bağlandı;
  Ayarlar sekmeli (Genel, Roller, Yetkilendirme, Modüller); Portal Kontrol → "Portal ilanları". Başlık adları: Müşteriler ve Talepler, Portföy ve İlanlar,
  Anlaşmalar ve Sözleşmeler, İletişim ve Pazarlama, Performans ve Raporlar, Ofis ve Ayarlar. İkon: Ofis Merkezi `ICONS.ofisMerkezi` (Ayarlar çakışması giderildi).
- **Palet:** `getAppGoItems` etiket+açıklama+eş anlamlıda arar, sekmeler "Öğe · Sekme" adıyla; açıklama satırı gösterilir.
- **Zenginleştirme (9 sayfa):** Akıllı Listeler `?segment=` filtre kontratı + grup bazlı boş durum + hızlı eylemler; Takımlar, Şubeler, Etiketler, Sözleşme
  şablonları, KVKK talepleri, Evrak linkleri, Otomasyonlar, Denetim: EmptyState + CTA. Talepler KPI "Yeni" eklendi. Dashboard KPI yerleşimi yalnız ÖNERİ
  (`docs/design/MENU_IA_2026_10.md` §6; `page.tsx`/`_home` hız ajanında, dokunulmadı).
- **Doğrulama (bu dalda):** tsc 0, eslint 0, check:links 0; tam vitest: 5008 geçti / 4 kırmızı — hepsi main'den gelen başka ajan işleri (Ofis Merkezi 2 test,
  cron sayısı 37 ↔ belgelerde 36). Menüyle ilgili tüm sözleşme testleri yeşil.

## 19. Self-servis kurulum sihirbazı + demo veri + tek tuş gerçek kullanım (PB44) — 2026-10-06, KODDA; migration CANLIYA UYGULANMADI

- **Karar:** satış "demo talebi / görüşme" akışı YOK. `/demo` sayfası, `requestDemo` action'ı ve `demo-intake` testi SİLİNDİ; eski adres kalıcı olarak `/kayit` (`next.config.ts` + yerleşik `LEGACY_REDIRECTS` `src/lib/seo/redirects.ts`, admin kuralı önce gelir); SEO envanterinde `/demo` yok (`seo-legacy-redirects.test.ts`). `demo_requests` tablosuna dokunulmadı; `/admin/satis` "Satış adayları (demo talepleri arşivi)". Admin ana panel dikkat satırı "Yeni demo talebi" → "Yeni deneme başlatan ofis" (`/admin/tenants?durum=trial`). Site içerik `demo` anahtarı şemada geriye dönük duruyor (editör kartı kaldırıldı).
- **Akış:** `/kayit` 6 adım (hesap → ofis [ad, il/ilçe GeoSelect, tür, danışman sayısı] → marka [logo, renk + brand-scope önizleme] → odak [segment, çalışılan ilçeler] → ekip daveti (≤3, atlanabilir) → "Demo veriyle başla" (varsayılan AÇIK) + yasal onay). İlerleme çubuğu, adım başına tek soru, `tfs-panel` geçişi (reduced-motion'a saygılı). Kayıt: provision_registration → `applyWizardOfficeProfile` (best-effort, uyarılar etkinlik günlüğüne) → `ensureSampleData` (idempotent; paket odaktan). Senkron yükleme (arka plan işi YAZILMADI: ölçülmedi; VARSAYIM birkaç saniye — 15 sn'yi aşarsa outbox'a taşınmalı).
- **Demo deneyimi:** `/app` kabuğunda kapatılamaz tek satır `DemoTrialStrip` (örnek veri ve/veya deneme; tone-warning, son gün tone-danger; mobilde sarar); ana ekrandaki kapatılabilir eski bant + `RealUsePanel` kaldırıldı (tek şerit). Liste/detay rozeti mevcut `SampleRecordBadge` (müşteri/portföy detay). Public sızma kontratı `src/lib/sample-data/public-sample-leak-contract.test.ts`; bu turda kapatılan açıklar: malik/müşteri portalı token üretimi ve veri okuyucusu örnek kayıtları süzmüyordu, müşteri portalı sayfasında bir sorgu süzgeçsizdi.
- **Gerçek kullanıma geç:** `/app/ayarlar/gercek-kullanim` (sayılarla onay, geri alınamaz uyarısı, başarı ekranı + 3 sonraki adım); Ayarlar'da kart. Eylem `clearSampleData`: `settings:edit` + owner/gm; RPC tek transaction, yetkiyi içeride tekrar doğrular (sözleşme `purge-rpc-contract.test.ts`: her DELETE `where is_sample = true and tenant_id = p_tenant_id`). Storage: örnek set dosya üretmediği için outbox işi yok. Sonuç `audit_logs` (`sample_data.clear`). "Demo veriyi yeniden yükle" YAPILMADI (Başlangıç sihirbazında boş ofiste yükleme zaten var).
- **14 gün deneme:** tek kaynak `getEffectiveTrialDays`/`platform_default_trial_days()` (provision RPC). 3/1 gün hatırlatması mevcut `abonelik-kontrol` cron'unda zaten var (zil bildirimi; e-posta sağlayıcısı yok). Bitiş: mevcut past_due → tolerans → suspended akışı (yeni kilit mantığı yok). Kalan gün şeritte, yan menüde ve `/app/abonelik`'te.
- **Admin:** `/admin/tenants` "Veri" rozeti (Demo veri var / Gerçek veri, tıklanınca süzer) + `veri=demo|gercek` filtre kontratı + KPI.
- **Test edilemeyenler:** gerçek DB'de RPC ve sihirbaz sütunları (migration uygulanmadı), logo storage yüklemesi, davet e-postası, tarayıcıda sihirbaz/şerit görünümü, build.

## 20. Hız turu 2 (kabuk + ana ekran) — 2026-10-06, KODDA; PB42 migration'ları CANLIYA UYGULANMADI

- **Migration (PB42, order 29.93, `--only` ile, backup/PITR sonrası):** `20261006000400_app_shell_bootstrap_rpc.sql` (`app_shell_bootstrap()` SECURITY INVOKER, kimlik `auth.uid()`, profil tenant'ı `current_tenant_id()` ile eşleşmezse NULL; profil + ofis + ham izin satırları + modül satırları + kullanım + rozet sayımları tek JSON) → `20261006000410_dashboard_snapshot_rpcs.sql` (`get_insights_snapshot/get_tasks_snapshot/get_metrics_snapshot`, INVOKER, `p_tenant_id`/`p_user_id` JWT ile eşleşmezse NULL; örnek veri kuralı `sample-scope` ile aynı, kod `sample_included` uyuşmazsa sonucu kullanmaz). Rollback'ler var; tablo/politika değişmez. Kolon adları şema dosyalarına karşı doğrulandı (customer_demands'ta assigned_to YOK, kullanılmadı).
- **Kod:** `src/app/app/layout.tsx` artık sayfayı BEKLETMEZ (çerçeve + iskeletler ilk baytta, kabuk dilimleri ayrı Suspense, cache'li `loadShellModel`); ofis skoru ayrı sınır. RPC varsa kabuk 1 tur, yoksa eski yol + istek-içi tek kimlik okuması. `requireModulePage` ve `modules/state` kabuk verisini paylaşır. Ana ekran: seri turlar paralel, ekran-altı satırlar `DeferredSection`, yükleyiciler anlık görüntüden okur. `loading.tsx` tüm /app segmentlerinde (redirect-only `ekip/kazanc` hariç). Kaldırılan: AppPrefetcher + `/api/app/bootstrap` + `use-app-api` (kimse okumuyordu), Google Fonts preconnect; Caveat yalnız hero sahnesinde. DataTable satırı/ChartFrame memo; admin danışman sohbeti, marka yöneticisi, belge lightbox'ı `next/dynamic`.
- **Beyaz etiket seçicisi:** `.brand-scope` kuralları ayrıca `.app-frame:has(> [data-brand-scope])` ile uygulanır (çerçeve veri beklemeden çizildiği için). `:has` desteklemeyen eski tarayıcıda marka rengi uygulanmaz (varsayılan renk).
- **Ertelenen:** `partialPrefetching` (Next 16.3 belgesi: `cacheComponents` olmadan config doğrulaması hata verir; cacheComponents bu turda açılmadı). Proxy sadeleştirmesi: proxy'deki 4 paralel okuma (profil, platform_staff, getClaims, tenant) bakım/kanonik kimlik/2FA/askıya alma kapılarının girdisi; kaldırmak kapıları zayıflatır. Ölçüm: `docs/design/HIZ_OLCUM_RAPORU_4.md` (build boyutları; canlı süre ölçülmedi).

## 21. Tasarım sistemi v4 — tek premium dil, /admin referans paneli (aşama A) — 2026-10-06, KODDA (dal `worktree-agent-a5601b79f75f833e9`); migration YOK

- **Kaynak:** kullanıcının /admin ekran görüntüsü ("aynısı veya benzeri"). Kılavuz `docs/DESIGN_SYSTEM.md` "Tasarım sistemi v4" (token tablosu, kanonik bileşenler, hareket katmanı, güncel 3B/GIF/Lottie/degrade/motion kararı).
- **Token tek kaynak:** lacivert (`--navy-*`, değişmez), altın (`--gold-*`, `--gold-ink`), `--pm-*-text`, `--space-1..12`, `--fs-kpi*`, `--card-shadow*`, `--sb-bg-*`, `--nav-badge-*`, `--hero-art` → `tokens.css` (koyu: `theme-dark.css` ilk blok). Kabuk CSS'lerinde lacivert hex yok (sözleşme testi). Hareket süreleri bilinçli olarak `motion.css`'te kaldı (tek tanım; 3 sözleşme testi oradan okur).
- **Kanonik bileşenler (`src/components/ui`):** `kpi-card` (KpiCard/KpiGrid/iskelet; tek uygulama `KpiTile`), `chart-frame` (ChartCard v4), `chart-tooltip` (TEK ipucu; Revenue/Donut kopyaları silindi), `chart-format`, `lazy-charts` (tembel Recharts kapısı tek yer; `app/_ui/lazy-chart` yeniden dışa aktarır; `AreaTrendChart`), `attention-list`, `insight-card`, `dashboard-hero` + `hero-play`, `segmented-control`, `status-tile`, `illustrations/city-skyline` + `ev/anahtar/haritaPin`, `console/user-menu-face`. Hareket `ui/motion` (Reveal/Stagger = motion `m.*`; FadeSwap = CSS). Eski adlar sarmalayıcı: StatCard, ChartFrame, EmptyStateV3, app/empty-state, app/skeleton, admin CountUp.
- **motion 14.0.0** kuruldu: yalnız LazyMotion(strict) + domAnimation (tembel parça) + `m.*`; içe aktarım yalnız `ui/motion` (`motion-layer.test.ts`). SegmentedControl layoutId KULLANMAZ (domMax gerekir) → CSS transform; FadeSwap AnimatePresence'sız (ölçüldü).
- **Kabuk:** iki yan menü `.sb-surface` + dolgulu vurgu aktif hap; admin menüsü arama kutusu kaldırıldı (üst çubuk Ctrl K), "Sistem durumu" kartı gerçek veriden (`AdminHealth.checkedAt`, önbellek anahtarı `admin-sidebar-badges-v5`); üst çubuk ev ikonlu konum şeridi, yuvarlak arama, dolgulu Hızlı erişim, saat, zil; MFA şeridi içerikte `tone-warning` kart. `src/app/app/layout.tsx`, `page.tsx`, `_home/**` DOKUNULMADI.
- **/admin paneli:** hero özeti KPI tekrarlamaz (en öncelikli iş bağlantısı); "deneme bitiyor" yalnız dikkat kuyruğunda; riskli ofis + churn TEK liste (askıda dahil; kuyrukta `risk: null`); yanlış "%X dönüşüm" kaldırıldı, GERÇEK deneme→ücretli eklendi; yeni bölümler: aktivasyon hunisi (örnek veri hariç gömülü sayım `properties!properties_tenant_id_fkey(count)` + `.eq("properties.is_sample", false)` — CANLI DB'DE DENENMEDİ), modül kullanımı, birim ekonomisi (ARPA; NRR "hesaplanamıyor" — aylık gelir anlık görüntüsü yok), AI/kontör tüketimi (6 ay defter, sayfalı), iptal nedenleri, MRR tahmini (etiketli doğrusal, ≥3 gerçek ay). Saf mantık `src/lib/admin/platform-metrics.ts` (+test), `dashboard-layout.ts` (`attentionLevel`, `churnLevel`, yeni bölüm türleri + billing kapısı). billing-home/support-home aynı bileşenlere geçti.
- **/admin/tenants filtre kontratı (yeni):** `durum=risk` (gecikmiş+askıda), `yeni=7|30|90` (kayıt penceresi), `deneme=bitiyor|bitti` + `gun=7|30|90`; çip + form gizli alanı + sayfalama taşır.
- **Görseller:** 4 PNG (9,2 MB) → `listing-bosphorus-villa.webp` (119 KB; next/image AVIF/WebP üretir); kullanılmayan 3 PNG silindi (sw.js + golden güncellendi).
- **Ölçüm (brotli ilk yük, `route-bundle-stats.json`, main e1208ff2 ile aynı tabanda):** /admin 202,4 → 223,0 KB (+20,6; motion çekirdeği ~19 KB), /app 209,2 → 209,4, /admin/tenants 203,0 → 203,6, /app/musteriler 231,8 → 231,9.
- **Birleştirme notu:** `dashboard-layout.ts`'te "trial-ending" satırı (href `?deneme=bitiyor`) main'in "new-trial" satırının hemen üstünde; çatışma çözüldü (ikisi korunur).
- **Sonraki aşama (B):** AdminStatCard (6 importer, koyu hero varyantı) ve StatRow'u KpiCard'a taşımak; importer'sız kalan HeroBanner/GlassKpi/CityNight'ı silmek; viz `SkeletonCard` ile ui `SkeletonCard` ad çakışmasını gidermek; ham `<table>` (36 dosya) → DataTable; diğer admin sayfalarının koyu hero'larını DashboardHero'ya almak.
- **Test edilemeyenler:** tarayıcıda görsel/mobil 360 px/koyu tema kontrolü, canlı DB'de yeni sorgular (gömülü sayım + embedded filtre, `cancel_reason`, `account_credit_ledger` sayfalama), Recharts tahmin çizgisi görünümü.
