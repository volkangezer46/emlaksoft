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

Canlıda uygulanan son: `20260813000300`. Aşağıdakilerin HİÇBİRİ uygulanmadı; kod hepsinde "etkin değil" ile zarifçe çalışır.
Sıra: yedek/PITR doğrula → `npm run check:migrations -- --database` → `npm run db:migrate -- --dry-run` → `npm run db:migrate` → `npm run db:rls-audit`.

**Ek (2026-10-05):** `20260821000100` mahalle notları · `20260821000200` yasal kayıt defteri · `20260821000300` evrak linkleri ·
**`20260823000100..000600` güvenlik denetimi 3 düzeltici migration'ları (approval_requests RLS+consumed_at, listing_pool insert/claim,
kvkk_requests rol, property_owner_info update kapsamı, advisor_private PII biçim CHECK, kupon max_per_tenant) — ilgili ana
migration'larla AYNI pencerede uygulanmalı.** Toplam uygulanmayan migration dosyası şu an 40 civarı (`ls supabase/migrations | awk '$0 > "20260813000300"'`).

`supabase/migrations/` (ilk 31 dosya, uygulanmayan): 20260814000100 telefon CHECK · 20260815000100 kayıp nedeni seed ·
20260816000100..001000 (komisyon payı/plan/ödeme, **000500 kazanç gizliliği RLS = davranış değiştirir, AYRI PENCERE**, hedef, atama kuralı) ·
001100 kampanya claim · 001200 atama kuralı ilan hedefi · 001300 danışman özel · 001400 uzmanlık/bölge · 001500 ilan havuzu ·
001600 örnek veri kapsamı · 001700 tenant_modules · 001790 SEO 404 · 010100 varsayılan deneme günü · 010200 oturum kapatma ·
20260817000210 Business planı · 000220 fiyat kilidi · 000230 kuponlar · 20260819010500 abonelik iptal/şube telefonu ·
010600 kvkk_requests · 020100 ilan sahibi bilgisi · 020200 havuz profil bayrakları · 20260820000100 ofis kontrol.

`supabase/proposed/` (henüz migrations'a TERFİ ETMEDİ; terfide yeni numara şart): vitrin ayarları (060100 eski numaralı!) ·
vitrin bölümleri/SEO opt-in (010700) · büyüme/referral (20260819000100) · sahiplik devri (020100) ·
faturalama duraklatma/oransal/Business/koltuk (20260820000100, **oversight ile AYNI numara**) · AI kredi (000300) ·
anket modülü (010000) · malik bağlantısı (20261005000100) · perf indeksleri.

**Fiyat bütünlüğü taslağı (tam gövdeli, `pg_get_functiondef+replace` YOK):** `supabase/proposed/20261005000500_billing_plan_amount_integrity.sql`
(+ rollback). `update_tenant_plan_subscription`, `fulfill_billing_payment` (10 arg), `provision_registration`, `convert_demo_request_to_tenant`
fonksiyonlarını yeniden yazar (tutar plan tanımından, yıllık = aylık×10, fiyat kilidi yazılır, Business dahil). **`20260820000100_billing_pause_proration_business_seats.sql`
taslağının D bölümünün YERİNE geçer; o taslak terfi ederken D bölümü ÇIKARILMALI** (aksi halde desen bulunamaz, A/B/C/E de uygulanmaz).
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
- "Öncelikli destek / Özel onboarding / SLA" gibi mekanizması olmayan hizmet vaatleri admin özellik listesinde duruyor.
- Admin "Önerilen kataloğu uygula" yapılana dek `plan_entitlements` limitleri eski (Profesyonel 20, yeni 15).
- Havuza yalnız elle ilan ekleme bağlı (içe aktarma/portal/ağ `enqueueListingPool`'a bağlı DEĞİL).
- Aktivite akışı tek zaman çizgisi değil; AI asistan SMS kartı ve gelen kutusu `SmsDialog` popup'ı kaldı; "Lead skoru" metni müşteri ekranlarında.
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
| Onay kuralları | `src/lib/oversight/approval-gate.ts` (varsayılan kapalı, 48 sa tek kullanımlık) |
| AI | yalnız `src/lib/ai/openai-client.ts` + `redact.ts`; kredi `src/lib/ai/credits/**` |
| SEO | `src/lib/seo/**`, admin `/admin/seo`, sitemap/robots dinamik |
| Danışman kimlik şifreleme | `src/lib/advisor/pii-crypto.ts` (`ADVISOR_PII_KEY`; anahtar yoksa alanlar kapalı) |
| Havuz/atama puanı | `src/lib/pool/score.ts` |
| Anket | `src/lib/surveys/**` (mevcut memnuniyet anketini genişletir) |
| Ürün turu | `src/lib/product-tour-data.ts` |
| Cron envanteri | `vercel.json` + `src/lib/cron-jobs.ts` (30 rota, `npm run check:cron`) |
| service_role | `src/lib/admin-client-allowlist.ts` (`audit-admin-client.ts --write`) |

## 7. Kararlar (değişmez, tekrar sorulmaz)

- Yanıtlar Türkçe. Popup yok, sekme/panel. Kararları sormadan ver (sert güvenlik hariç: zorunlu 2FA/TOTP vb. onaysız eklenmez;
  `PLATFORM_MFA_ENFORCEMENT=on` yayın öncesi açılacak, şu an kapalı). Özet panelinde maskeleme yok.
- Fiyat kataloğu (kullanıcı onaylı): Danışman 749 · Ofis 2.490 (ek kullanıcı 399) · Profesyonel 4.990 (15 kullanıcı, ek 349) ·
  Business 8.990 (varsayılan gizli) · Kurumsal özel; yıllık "10 öde 12"; ücretsiz paket YOK; deneme süresi tek kaynak
  (`getEffectiveTrialDays`, migration sonrası 30 gün); Founders kampanyası admin düzenlenebilir; ödül/ortak oranları kodda sabit DEĞİL.
- Demo veri public vitrine/portal/sitemap'e sızmaz; demo danışman hesabı AÇILMAZ (auth.users bağı); tüm demo kayıtlar kurucuya atanır.
- Onay kuralı muafiyeti owner/gm ile sınırlanmalı (denetim 3, #5); ofis kapatma veri paketi yalnız platformun `completed` yaptığı talepte.
- Anketör rol değil, atanabilir görevdir. Tetikleyiciler kapalı doğar, geriye dönük anket üretilmez.
- Ofis kapatma = arşivleme (veri SİLİNMEZ); sahibe CSV veri paketi (ZIP yok).
- Kimlik/vergi no ilan sahibi tablosunda tutulmaz (veri minimizasyonu).

## 8. Sahip kararları / işleri (özet)

Migration uygulama (sıra §2) · `git push` (§1) · `ADVISOR_PII_KEY` üretimi (`openssl rand -hex 32`, kaybedilirse TC/IBAN geri gelmez) ·
Supabase redirect allowlist'e `/app/hesabim?eposta=onay` · fiyat/DB tutarı kararı (§3) · Google Search Console'a sitemap ekleme ·
yayın öncesi güvenlik (MFA bayrağı, demo kartlarını kapat, anahtar rotasyonu, yedek/PITR) · TÜFE/kredi faizi/harç doğrulaması ·
ödül/ortak programı oranları · canlı QA (mobil form çubuğu, menü yoğunluğu, pano sürükle-bırak, ofis açma, yeni TV/tur/sihirbaz).

## 9. Belge dizini (nerede ne var)

`docs/design/BIRLESIK_YOL_HARITASI.md` (yol haritası, terim sözlüğü, 15 çelişki kararı) · `ONERI_LISTESI_KARSILASTIRMA.md` (113 madde) ·
`ISLEM_TAMLIK_DENETIMI.md` · `DANISMAN_UZMANLIK_HAVUZ_DEMO_SPEC.md` · `PIYASA_VE_FARK_YARATAN_OZELLIKLER.md` (F1-F5) ·
`ORGANIK_BUYUME_PLANI.md` · `BILLING_PAUSE_PRORATION_DESIGN.md` · `OFIS_SAHIPLIGI_DEVRI.md` · `GUVENLIK_DENETIMI_3.md` ·
`docs/DURUM.md`, `MIMARI.md`, `ROADMAP.md`, `DEPLOY.md`, `DESIGN_SYSTEM.md` · `docs/security/` (admin client envanteri) ·
`.claude/agents/` (birlestirme, canli-qa, guvenlik, hiz, migration ajanları).
