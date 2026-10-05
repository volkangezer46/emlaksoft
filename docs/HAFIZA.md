# EmlakSoft — Proje Hafızası (TEK MERKEZ)

Bu dosya projenin **tek kayıt defteridir**. Yeni bir oturum/ajan işe başlarken önce bunu okur; durumu sıfırdan
taramaz. Bir iş bittiğinde, bir karar alındığında ya da bir şey yayınlandığında BURASI güncellenir.
Ayrıntı için ilgili belgeye bağlanır (içerik burada kopyalanmaz). Son güncelleme: 2026-10-05.

## 1. Yayın durumu (en kritik)

- **Canlı (`origin/main`): `cf8ec63`.** Modüller (aç/kapa) + menü 41→36, K1, K2, K3, K5, K6, SEO merkezi, bakım modu, ana kapı.
- **Yerelde yayınlanmamış: `origin/main`in ~70 commit önünde.** Hepsi izole klonda tam doğrulandı (tsc, eslint, vitest,
  check:links/cron, audit:actions, build). Son tam yeşil doğrulanan HEAD: `45d121a` (293 dosya, 2996 test).
- **Push engelli:** otomatik izin sınıflandırıcısı `git push` komutunu reddetti. Sahip kendisi `git push origin main`
  çalıştırır ya da Bash için `git push` izin kuralı ekler. Aşılmaya çalışılmaz.
- Yerelde yayınlanmamışlar: K5 hesap/ofis/devir, faturalama tamamlama, ana sayfa yenileme + mega menü + fiyat tek kaynak,
  danışman profili (uzmanlık/bölge/şifreli kimlik/belge), ilan havuzu + atama + ilan sahibi, ofis kontrol merkezi + onay kancası,
  anket modülü, tam demo + "gerçek kullanıma başla" + sihirbaz + rol bazlı tur + TV, demo KPI eşiği + terim/rol/ay temizliği,
  AI kredi ölçümü, müşteri zekâsı + lead hızı + AI cevap taslağı (`a5f2086`, henüz doğrulanmadı).

## 2. Migration durumu (KRİTİK: hepsi sahibin işi)

**GÜNCEL DURUM (2026-10-05, kullanıcı onayı + yedek/PITR teyidiyle, `--only` ile pencere pencere):** `migrations/` altındaki 41 dosyanın **40'ı CANLIDA UYGULANDI**
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

**PB9 EmlakFiyati kontör (HAZIRLANDI, UYGULANMADI; sahip bildirimi: 13 terfi + P12 canlıda):** `20260826000100_ef_credit_wallet`
(defter `ef` birimi, `ef_credit_reservations`, 7 service_role RPC: `config.ts` EF_RPC birebir; 0 kontör = doğrudan kesinleşmiş kayıt,
kontör süresiz, `ef_credit_ready()` SQL editöründe false) → `20260826000200_ef_reports` → `20260826000300_ef_credit_pack_fulfillment`
(fulfill/v2 `credit_pack`; taban 000600 gövdesi bayt bayt, md5 kanıtı `src/lib/ef-credits/ef-wallet-sql-contract.test.ts`).
Sıra/sorgular `YAYIN_PENCERESI_2.md` §7; prova `npm run db:rehearse -- --yes-i-understand-locks --ef` (koşulmadı). TS kontör akışı YOK.

**PB10 TL HESAP KREDİSİ (HAZIRLANDI, UYGULANMADI):** `20260826000400_try_credit_wallet` (defter `try` birimi, `try_credit_reservations`, service_role RPC'ler:
`try_credit_balance/grant/reserve/commit/release/reverse`, ofis okuma `try_credit_my_overview()` + `try_credit_movements` görünümü; bakiye = defter TEKRAR OYNATMA, vade FIFO,
clawback eksiye düşebilir ama harcanamaz) → `20260826000500_try_credit_invoice_payment` (`try_credit_fulfill_invoice` fulfill/v2'yi İÇERDEN çağırır, fulfill gövdelerine DOKUNMAZ;
`try_credit_invoice_hold/release_invoice/release_dead/refund_invoice`, `try_credit_ready()`). Sıra: 000100 (source CHECK refund/bonus + meta) SONRA. TS: `src/lib/try-credits/*`
(sözleşme `config.ts`, testler `try-wallet-sql-contract.test.ts` + pglite'lı `try-wallet-sql-exec.test.ts`: `npm i --no-save @electric-sql/pglite`). Ödeme: faturada "Hesap kredimi kullan"
(`use_credit=1`), tek faturada en fazla `platform_settings.try_credit.max_invoice_share` (varsayılan 0.5; 1 = tam kredi/iyzico'suz), iyzico yalnız nakit kalanı; iade önce nakitten düşer, artan kredi geri yazılır.
`/app/abonelik?sekme=cuzdan` Cüzdan bölümü. Ortaklık/tavsiye işi `try_credit_grant/reverse`'e bağlanır (kind: referral|partner|campaign|manual|bonus|refund).

**PB11 REFERANS/ORTAK MOTORU (HAZIRLANDI, UYGULANMADI, bayraklar KAPALI):** `20260826000600_growth_referral_engine` (000800 + 000900 + 000400/000500 SONRASI). Müşteri-getir-müşteri (Faz 1, çift taraflı, kredi nakde çevrilmez):
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

## 4. Çalışan ajanlar (2026-10-05; raporlar gelince bu bölümü güncelle)

Yerelde birleşenler (hepsi `main`'de, push bekliyor): güvenlik denetimi 3 (kod + SQL düzeltmeleri; rapor `docs/design/GUVENLIK_DENETIMI_3.md`),
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
| Örnek veri | `src/lib/sample-scope.ts` (+ `sample-clear.ts`, `sample-data-seed.ts`) |
| Danışman metriği/gelir | `src/lib/team/advisor-metrics.ts` (ofis brüt yalnız `earnings_all`) |
| Telefon | `src/lib/phone-rules.ts` (`parsePhoneStrict`), `PhoneInput` |
| Rol etiketi / terim | `src/lib/role-labels.ts`, `src/lib/terminology.ts` |
| Zaman | `src/lib/clock.ts` (TR ay sınırları `trMonth*`) |
| Menü | `src/lib/nav-config.ts` (37 öğe/9 başlık sözleşmesi, ikonlar benzersiz `src/lib/icons.ts`) |
| Modül aç/kapa | `src/lib/modules/**` (registry, guard, pending-defs); tablo yokken hepsi açık |
| Onay kuralları | `src/lib/oversight/approval-gate.ts` (varsayılan kapalı, 48 sa tek kullanımlık; muafiyet yalnız owner/gm, `APPROVAL_EXEMPT_ROLES`; karar yetkisi `APPROVAL_DECIDER_ROLES`; tek mesaj `APPROVAL_PENDING_MESSAGE`) |
| AI | yalnız `src/lib/ai/openai-client.ts` + `redact.ts`; kredi `src/lib/ai/credits/**` |
| SEO | `src/lib/seo/**`, admin `/admin/seo`, sitemap/robots dinamik |
| Danışman kimlik şifreleme | `src/lib/advisor/pii-crypto.ts` (`ADVISOR_PII_KEY`; anahtar yoksa alanlar kapalı) |
| Havuz/atama puanı | `src/lib/pool/score.ts` |
| Anket | `src/lib/surveys/**` (mevcut memnuniyet anketini genişletir) |
| Ürün turu | `src/lib/product-tour-data.ts` |
| Cron envanteri | `vercel.json` + `src/lib/cron-jobs.ts` (33 rota, `npm run check:cron`) |
| service_role | `src/lib/admin-client-allowlist.ts` (`audit-admin-client.ts --write`) |
| EmlakFiyati TEK ADAPTÖR (emlakfiyati.com'a TÜM çağrılar) | `src/lib/integrations/emlakfiyati/`: `adapter.ts` (tek `fetchExternal`; `emlakFiyatiGet(path, query)` tür-güvenli ince çekirdek, geri çekilme+jitter, en çok 4 eşzamanlı, bellek önbelleği, 401/403/429/5xx/ağ sınıflandırma, istek sayacı + `onEmlakFiyatiRequest` kancası [kontör ADAPTÖR DIŞINDA], 401 alarmı, `probeEmlakFiyatiConnection`), `policy.ts` (saf: izinli yol/başlık beyaz listesi, anahtar biçimi/maske, `X-Ortak-Kullanici-Ref` ve `Idempotency-Key` yardımcıları), `keys.ts` (anahtar çözümleme: admin şifreli > env `EMLAKFIYATI_API_KEY` yedek; rotasyon current/previous 7 gün), `ortak.ts` (ortak uç KAPISI + takma ref), `admin-status.ts`; şifreleme `src/lib/platform-secrets.ts` (`PLATFORM_SECRETS_KEY`, AES-256-GCM, `pii-crypto` kalıbı); admin ekranı `/admin/sistem?sekme=emlakfiyati` + `src/app/actions/platform-emlakfiyati.ts` (süper admin yazar, ops okur). Sözleşme testi: `single-adapter-contract.test.ts` |
| EmlakFiyati KONTÖR (tarife/paket/cüzdan/satış) | **Sözleşme** `src/lib/ef-credits/config.ts` (tarife+paket şemaları, RPC adları; DEĞİŞTİRİLMEZ). **Okuyucu** `credit-reader.ts` (ef_credit_ready yoklaması 60 sn, katalog [tag `ef-credit-config`], bakiye, geçmiş, son kontör faturası), saf görünüm `credit-view.ts`, admin `admin-data.ts` (ofis bakiye listesi, manuel yükleme RPC) + saf `admin-grant.ts` (doğrulama, ÖRNEK 4 paket ön ayarı). **Cüzdan/servis (wallet.ts, service.ts) BAŞKA AJANDA.** Satış: saf `src/lib/billing/credit-pack-purchase-core.ts` (KDV=invoiceAmountsTry, kontör başı, düşük bakiye eşiği, öneri), sunucu `credit-pack-purchase.ts` (fatura meta.kind=credit_pack), action `startCreditPackPurchase` (billing.ts). Ofis ekranı `/app/abonelik?sekme=kontor`; admin `/admin/ef-kontor` (süper admin yazar, ops okur, `updateTag`). Cüzdan hazır değilse (ef_credit_ready) HER ŞEY "etkin değil", para tahsil eden yol AÇILMAZ; kupon paketlerde KAPALI; demo ödeme yok. **SAHİP İŞLERİ:** paket fiyatları (katalog varsayılan BOŞ; admin"Örnek ön ayar" yalnız öneri) ve tarife değerleri (varsayılan EF_DEFAULT_TARIFF). Geçmiş okuyucusu defter sütunlarında hoşgörülüdür (kind/entry_type, units/amount, item/feature); cüzdan SQL canlıya girince gerçek sütun adlarıyla doğrulanmalı |
| Piyasa endeksi (EmlakFiyati) | `src/lib/integrations/emlakfiyati/` (`contract.ts` saf: zod yanıt, slug yolu, tip eşlemesi `konut`/`arsa`; `client.ts` yalnız `adapter.ts` üzerinden: `getEndeks`, `getEndeksForPlace`, 12 sa `unstable_cache` + kısa negatif önbellek; 429'da Retry-After YOK, geri çekilme adaptörde); panel `src/components/app/emlakfiyati-endeks-panel.tsx`; değerleme kaynağı `src/lib/valuation.ts`. Endeksa ve TapuSor KALDIRILDI (kullanıcı kararı); eski `platform_settings` anahtarları (`endeksa_*`, `tapusor_*`) kodda okunmaz, temizlik migration'ı yazılmadı |

### 6b. EmlakFiyati: sahip işleri ve "ortak uçlar bekliyor" (2026-10-05)

**Sahip işleri:** (1) Vercel production'da `PLATFORM_SECRETS_KEY` tanımla (`openssl rand -hex 32`; kaybedilirse Admin'deki anahtar yeniden girilir) ·
(2) Admin > Sistem > EmlakFiyati'dan API anahtarını gir (env `EMLAKFIYATI_API_KEY` artık YEDEK; admin kaydı önceliklidir) ·
(3) "Bağlantıyı dene" ile doğrula · (4) anahtar rotasyonunda yeni anahtar girilir, eski 7 gün geçerli kalır (EmlakFiyati sözleşmesi).

**Ortak uçlar BEKLİYOR (kod yazılmadı, canlıya bağlanmadı):** EmlakFiyati değerleme ve rapor PDF uçlarını henüz yayınlamadı.
Adaptörde yalnız kapı (`ortakGate`, bayrak varsayılan KAPALI, `ORTAK_ENDPOINTS_VERIFIED=false`) ve başlık yardımcıları var.
Geldiklerinde zorunlu: `X-Ortak-Kullanici-Ref` (takma ref, 8-64 karakter) + `Idempotency-Key`. Kontör EmlakSoft'ta düşer, mutabakat için EmlakFiyati aylık kullanım dökümü verir.
**ŞEMA GEREKLİ (EmlakFiyati'ndan, tahmin edilmedi):** ortak değerleme isteği/yanıtı, ortak rapor PDF ucu (yol, kimlik, süre, hata gövdesi), kontör/birim bilgisi yanıtta var mı,
`/api/ara`, `/api/grafik/seri|iller|genel`, `/api/dashboard`, `/api/rayic`, `/api/resmi-duyurular`, `/api/parsel*` (mahalle, ornekler, kademe), `/api/konut-kapsama`, `/api/disa-aktar`, `/api/ilanlar`
için sorgu parametreleri ve yanıt şemaları (adaptör yalnız `get(path, query)` çekirdeği sunar; yalnız `/api/endeks` path+tip doğrulandı). `/api/parsel/rapor?format=pdf` kullanıcı ürününde KULLANILMAZ.
`docs/design/EMLAKFIYATI_KONTOR_MIMARISI.md` §5 (HMAC imza başlıkları `X-ES-*`) EmlakFiyati'nın bildirdiği sözleşmeyle UYUŞMUYOR (Bearer + `X-Ortak-Kullanici-Ref` + `Idempotency-Key`); kontör kodu yazılmadan önce o belge güncellenmeli.

## 7. Kararlar (değişmez, tekrar sorulmaz)

- Yanıtlar Türkçe. Popup yok, sekme/panel. Kararları sormadan ver (sert güvenlik hariç: zorunlu 2FA/TOTP vb. onaysız eklenmez;
  `PLATFORM_MFA_ENFORCEMENT=on` yayın öncesi açılacak, şu an kapalı). Özet panelinde maskeleme yok.
- Fiyat kataloğu (kullanıcı onaylı): Danışman 749 · Ofis 2.490 (ek kullanıcı 399) · Profesyonel 4.990 (15 kullanıcı, ek 349) ·
  Business 8.990 (varsayılan gizli) · Kurumsal 12.900 (50 kullanıcı dahil, ek 249/199/149 kademeli, en fazla 500; "özel teklif" YOK, `customPricing` alanı kaldırıldı); yıllık "10 öde 12"; ücretsiz paket YOK; deneme süresi tek kaynak
  (`getEffectiveTrialDays`, migration sonrası 30 gün); Founders kampanyası admin düzenlenebilir; ödül/ortak oranları kodda sabit DEĞİL.
- Aylık kontör hakkı (`efCreditsMonthly`): Danışman 10 · Ofis 40 · Profesyonel 120 · Business 300 · Kurumsal 400 + ek kullanıcı başı 6 (`efCreditsPerExtraSeat`, cron `ef-kontor-hak` `subscriptions.extra_seats` ile ölçekler; sütun yoksa 0). Ek rapor paketi = admin kontör kataloğu (`ef.packs`), ofiste Abonelik > Kontör; ana sayfada `EmlakFiyatiSection`.
- Demo veri public vitrine/portal/sitemap'e sızmaz; demo danışman hesabı AÇILMAZ (auth.users bağı); tüm demo kayıtlar kurucuya atanır.
- Onay kuralı muafiyeti owner/gm ile sınırlanmalı (denetim 3, #5); ofis kapatma veri paketi yalnız platformun `completed` yaptığı talepte.
- Anketör rol değil, atanabilir görevdir. Tetikleyiciler kapalı doğar, geriye dönük anket üretilmez.
- Ofis kapatma = arşivleme (veri SİLİNMEZ); sahibe CSV veri paketi (ZIP yok).
- Kimlik/vergi no ilan sahibi tablosunda tutulmaz (veri minimizasyonu).

## 8. Sahip kararları / işleri (özet)

Migration uygulama (sıra §2) · `git push` (§1) · `ADVISOR_PII_KEY` üretimi (`openssl rand -hex 32`, kaybedilirse TC/IBAN geri gelmez) ·
Supabase redirect allowlist'e `/app/hesabim?eposta=onay` · fiyat/DB tutarı kararı (§3) · Google Search Console'a sitemap ekleme ·
yayın öncesi güvenlik (MFA bayrağı, demo kartlarını kapat, anahtar rotasyonu, yedek/PITR) · TÜFE/kredi faizi/harç doğrulaması ·
ödül/ortak programı oranları · KVKK açık rıza metni ("tanıtım amacıyla", `src/lib/legal-copy.ts`; asıl amaç talebe dönüş) AVUKAT ONAYI GEREKİR · **Vercel production env `EMLAKFIYATI_API_KEY` tanımla** (sunucu sırrı; yoksa piyasa endeksi "bağlantı yok" görünür) · canlı QA (mobil form çubuğu, menü yoğunluğu, pano sürükle-bırak, ofis açma, yeni TV/tur/sihirbaz).

## 9. Belge dizini (nerede ne var)

`docs/design/BIRLESIK_YOL_HARITASI.md` (yol haritası, terim sözlüğü, 15 çelişki kararı) · `ONERI_LISTESI_KARSILASTIRMA.md` (113 madde) ·
`ISLEM_TAMLIK_DENETIMI.md` · `DANISMAN_UZMANLIK_HAVUZ_DEMO_SPEC.md` · `PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` (F1-F5) ·
`ORGANIK_BUYUME_PLANI.md` · `REFERANS_PROGRAMI.md` · `BILLING_PAUSE_PRORATION_DESIGN.md` · `OFIS_SAHIPLIGI_DEVRI.md` · `GUVENLIK_DENETIMI_3.md` ·
`docs/DURUM.md`, `MIMARI.md`, `ROADMAP.md`, `DEPLOY.md`, `DESIGN_SYSTEM.md` · `docs/security/` (admin client envanteri) ·
`.claude/agents/` (birlestirme, canli-qa, guvenlik, hiz, migration ajanları).

## 6. Kayıtlı kart (iyzico kart saklama) — 2026-10-05, UYGULANMADI

Kart BİZDE değil iyzico'da. Migration `20260826000100_payment_cards.sql` (+rollback) `payment_cards` + `tenant_payment_profiles` + `set_default_payment_card` (PB9, uygulanmadı;
tablolar yokken kod zarifçe kapalı). Ofis düzeyi kapsam (owner/gm yönetir). Ekleme: ödeme ekranında varsayılan KAPALI "Kartımı sakla" (fatura meta `saveCard`), callback doğrulama
zincirinden SONRA `saveCardFromPayment`. Liste/varsayılan/sil: `/app/abonelik` + `src/app/actions/payment-cards.ts`; sil iyzico'dan da siler (`card-store.ts`). Kayıtlı kartla ödeme =
Checkout Form'a `cardUserKey` verilir (iyzico sayfası kartı listeler; 3DS iyzico'da). Otomatik yenileme altyapısı `auto-renew.ts` (dunning cron içinde) `platform_settings`
`billing.auto_renew_enabled`="true" olmadan ÇALIŞMAZ + ofis rızası şart. PCI sözleşme testi `pci-card-data-contract.test.ts`. Açık doğrulamalar: CF retrieve yanıtında
`cardUserKey/cardToken` dönüşü, off-session `/payment/auth` için iyzico satıcı onayı (sandbox/hesap gerekir).
