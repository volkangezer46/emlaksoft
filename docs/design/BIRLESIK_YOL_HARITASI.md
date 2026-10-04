# EmlakSoft Birleşik Yol Haritası, Migration Planı ve Kafa Karışıklığı Denetimi

Tarih: 2026-10-04 · Taban: `main` (HEAD 57dc2c7) · Kapsam: yalnız belge; kod, canlı DB ve migration DEĞİŞMEDİ.
Bu belge, `docs/design/` ve `docs/` altındaki yol haritası, denetim, persona, piyasa, QA, hız ve spec belgelerinin açık
maddelerini TEK tabloda toplar. Yeni özellik fikri üretmez; mevcut bulguları birleştirir, çelişkileri tek karara bağlar.
Bundan sonra "ne yapılacak?" sorusunun cevabı bu belgedir (bölüm 8: diğer belgelerin akıbeti).

Doğrulama yöntemi: "YAPILDI" denen her madde için dosya/rota koddan okundu (kanıt sütunu). Okunmayan şey "doğrulanamadı"
yazıldı. Çalıştırılan tek komut: `validate-migrations.ts` (statik, salt-okunur): "Migration kontratı sağlıklı: 197 dosya ·
son 20260816001600_sample_data_scope_extension.sql". `type-check/lint/test/build`, canlı DB, `--database` ledger kontrolü,
`db:rls-audit` BU TURDA ÇALIŞTIRILMADI. Hukuki iddia yapılmaz; mevzuat/hukuk maddeleri "sahibin/hukukçunun kararı" olarak işaretlidir.

---

## 0. YÖNETİCİ ÖZETİ (1 sayfa)

1. **Neredeyiz.** Omurga (müşteri, talep, portföy, randevu, anlaşma, komisyon, kayıp-kaçak, değerleme, otomasyon, AI, vitrin, portallar)
   canlıda. Son iki haftada menü 9 başlığa indi, rol bazlı sade görünüm, rol bazlı ana ekran, hızlı kayıt, Müşteri 360, Ekip Merkezi
   (tek veri kaynağı `advisor-metrics`), kurulum sihirbazı, yardım merkezi, tema/hareket sistemi ve sayfa-içi sekmeli formlar bitti (bölüm 2.1, kanıtlı).
2. **Şu an başkalarında** (tekrar önerilmedi): K1 admin, K2 faturalama/plan/kupon, K3 müşteri/talep/iletişim, K4 portföy/proje/portal/KVKK belge
   sızıntısı, K6 ayarlar/iş takibi/finans, telefon girişi, TV modu, demo (is_sample) sızıntı P0, /araclar, Modüller (aç/kapa) + menü 41→36, SEO robot. K5 K2 bitince.
3. **Uygulanmamış migration: 18 dosya main'de + 6 dosya ajan dallarında + 3 taslak.** Sıralı liste ve grup planı bölüm 4. En acil ikisi
   davranış düzeltmesidir, özellik değil: `20260814000100` (telefon CHECK'i: kod yabancı/sabit hat yazıyor, DB eski CHECK'i hâlâ `^05\d{9}$`) ve
   `20260816001100` (kampanya teslimatı canlıda `23514` ile takılmış olabilir, QA_CANLI_RAPOR_3 YENİ-2).
4. **Tek riskli migration: `20260816000500` (kazanç gizliliği RLS).** Davranış değiştirir: şube müdürü/takım lideri/danışman `commissions`'ı yalnız kendi
   satırı kadar görür. Kodda `.from("commissions")` 14 dosyada geçiyor (hangilerinin kullanıcı, hangilerinin admin client'ı olduğu tek tek doğrulanmadı); etki taraması + rol smoke'u yapılmadan uygulanmaz. Diğer 17 dosya additive/gevşetici.
5. **Faz 2/Faz 3 şema yok ama kod da yok.** `commission_splits`, `assignment_rules`, `listing_pool`, `advisor_*`, `create_customer_with_demand` için `src/` içinde
   yalnız bir sözleşme testi ve bir yorum var; yani "şema yokken gizlenen özellik" yoktur, özellik henüz yazılmamıştır. Şema-önce, kod-sonra kuralı korunur.
6. **Üç yeni çatışma bu turda bulundu** (belgelerde yok): (a) K1 ve K2 ayrı migration'larla aynı iki fonksiyonu (`provision_registration`, `convert_demo_request_to_tenant`) yeniden
   tanımlıyor, deneme günü iki farklı anahtardan okunuyor (son uygulanan ötekini ezer); (b) `supabase/proposed/20260816001200_growth_...` ile `migrations/20260816001200_assignment_rules_listing_target`
   aynı numarayı taşıyor; (c) `20260814_perf_indexes*.sql` 8 haneli adla `check:migrations` desenine uymaz (taşınırsa yeniden adlandırılmalı).
7. **Kafa karışıklığı en çok şuradan geliyor** (bölüm 5): "kayıp" kelimesi 3 ayrı kavram için, "hakediş/kazanç/cüzdan/pay" 4 adla bir kavram için, "lead/aday/talep" 3 adla,
   "yetki" 4 anlam için; 8 yerde yerel kopya rol etiketi (+ `role-labels.ts`); 40 yerel durum etiketi sabiti; 3 empty-state, 2 stat bileşeni, 2 skeleton, 7 sekme/panel sistemi; ay sınırı hesabı 7 yerde farklı (3 TR-doğru, 4 UTC/yerel).
8. **Belgeler:** `DURUM.md` (179 migration der, gerçek 197), `MIMARI.md` (79 migration, 13 cron der), `ROADMAP.md` §4 (çözülmüş çelişkileri açık gösterir),
   `YOL_HARITASI_V2.md` ("StatRow/EmptyStateV3 ölü" der, artık kullanılıyor), `AUDIT_2026-08-13.md` ("yayın bloklu" der) bayat. Öneri: bu belge tek yol haritası olur, 5 belge `arsiv/`e gider (bölüm 8).
9. **Sıra (bölüm 3):** Dalga 1 = şemasız ve K-paketleriyle çakışmayan işler (yalnız lib + docs + sahipsiz ekranlar: tek-kaynak yardımcılar, terim sözlüğü, lead hızı, müşteri ısısı, AI cevap taslağı,
   doğal dil, foto kalitesi, belge temizliği). Dalga 2 = migration G0-G4 sonrası kod (Faz 2/3: pay/plan/hakediş, talep alanları, atama, uzmanlık, havuz, demo). Dalga 3 = dış hesap/anlaşma. Dalga 4 = ertele/ele.
10. **Sahibin vermesi gereken 10 karar:** (1) migration penceresi + yedek/PITR onayı + 05'in zamanı; (2) deneme süresi tek kaynağı (K1 mi K2 mi) ve yeni fiyat kataloğu;
    (3) PII anahtarı (TC/IBAN saklansın mı); (4) havuz varsayılanı + paket + yeni cron; (5) demo danışman `auth.users` + "Gerçek kullanıma başla" yetkisi; (6) ödül/ortak programı (tutar, kredi/nakit, hukukçu);
    (7) menü 41→36 ve Modüller ön ayarları/kapatılamaz çekirdek; (8) yayın öncesi güvenlik (MFA bayrağı, demo kartları, secret rotasyonu: sahip işi); (9) dış hesaplar (WhatsApp Business, Emlakfiyati, e-imza/KVKK/MASAK hukuk teyidi);
    (10) TÜFE/faiz/harç verisinin doğrulanması + eski randevu kayıtlarının UTC düzeltmesi. Ayrıntı bölüm 7.

---

## 1. Okuma kılavuzu

- Durum etiketleri: YAPILDI (kodda doğrulandı) · DEVAM EDİYOR (başka ajan) · SIRADA (şemasız, sahipsiz) · MİGRATION BEKLİYOR · SAHİBİN KARARI · ERTELENDİ · ELENDİ.
- Değer/risk/efor: Y/O/D (yüksek/orta/düşük) ve S (en çok 2 gün) / M (en çok 1 hafta) / L. Tahmindir, ölçüm değildir.
- Yol kısaltmaları: `app/…` = `src/app/app/…`, `lib/…` = `src/lib/…`, `actions/…` = `src/app/actions/…`.
- K1..K6 paket kapsamları `ISLEM_TAMLIK_DENETIMI.md` §4'tedir; bu belge o kapsamı kopyalamaz, yalnız durumunu söyler.

---

## 2. TEK BİRLEŞİK BACKLOG

### 2.1 YAPILDI (kodda doğrulandı; belgelerde hâlâ "açık" görünenler dahil)

| ID | Madde | Kaynak belge(ler) | Kanıt (dosya/rota) |
|---|---|---|---|
| Y-01 | Menü 9 başlık, sade görünüm, rol başına çekirdek menü | SADELIK, PERSONA_*, MODUL_ENVANTERI | `lib/nav-config.ts`, `lib/nav-roles.ts` (owner/gm/bm 11, danışman/takım lideri 12, çağrı merkezi 5) |
| Y-02 | Rol bazlı ana ekran, sıradaki en iyi eylem, karar bekleyenler; `/app/brifing` ana ekrana birleşti | SADELIK §11, PERSONA_*, MODUL_ENVANTERI §4.1 #3 | `app/_home/siradaki.ts`, `_home/karar-bekleyenler.tsx`; `app/brifing/page.tsx` yalnız `redirect("/app")` |
| Y-03 | Hızlı kayıt (müşteri, görüşme notu, randevu) | PERSONA_DANISMAN #2, SADELIK #4 | `app/hizli/page.tsx`, `hizli/quick-capture.tsx`; sidebar + palet bağlı |
| Y-04 | Müşteri 360 + ortak olay akışı; portföy ve anlaşma zaman çizelgesi | PERSONA_*, ISLEM | `components/ui/activity-timeline.tsx`, `app/musteriler/[id]/customer-360-tabs.tsx` |
| Y-05 | Ofis kurulum sihirbazı, danışman hoş geldin akışı, ürün turu | SADELIK, ROADMAP P1 | `app/baslangic/setup-wizard.tsx`, `app/hos-geldin/hosgeldin-akisi.tsx`, `app/product-tour.tsx` |
| Y-06 | Anlaşma kapanış sihirbazı + sürükle-bırak pano (dnd-kit) | ISLEM, PERSONA_OFIS | `app/anlasmalar/[id]/kapanis-sihirbazi.tsx`, `anlasmalar/board-dnd.ts`, `deal-board.tsx` |
| Y-07 | Ekip Merkezi: Danışman 360, Kıyas, Performansım; tek veri kaynağı `loadAdvisorMetrics` (danisman-kpi, lig, kıyas, pano-tv, Performansım, Danışman 360, Kazanç ofis sekmesi 8 yerde kullanır); `ekip/kazanc` → `cuzdan?sekme=ofis` | ADVISOR_AND_MATCHING_SPEC §5/§7, MODUL_ENVANTERI §4.1 #1-2 | `lib/team/advisor-metrics.ts`; `app/ekip/kazanc/page.tsx` (redirect); `lib/earnings-bypass-contract.test.ts` |
| Y-08 | Kazanç gizliliği ARAYÜZ/SUNUCU katmanında (`earnings_all`): export, AI bağlamı, hedefler maskesi, anlaşma detayı | DENETIM_RAPOR_2 B1 | `earnings_all`/`canSeeAllEarnings` 28 dosyada; `app/hedefler/page.tsx:113` (`revenueVisible`); `actions/export.ts`, `lib/ai/advisor-scope.ts`. DB katmanı (05) HÂLÂ yok, bkz. M-07 / O-03 |
| Y-09 | Tek sayfa "Yeni danışman" (5 sekmeli) | PERSONA_OFIS, ISLEM | `app/ekip/yeni/advisor-form.tsx` |
| Y-10 | Yardım merkezi, HelpTip, jargon temizliği, sözlük (16 madde) | SADELIK §5 | `app/yardim/`, `lib/help-content.ts` (`GLOSSARY`) |
| Y-11 | Giriş anında mükerrer kayıt uyarısı (müşteri/portföy/talep) | PERSONA_DANISMAN, DENETIM | `components/app/duplicate-hint.tsx`, `use-duplicate-check.ts` |
| Y-12 | 16 tam sayfa "Yeni X" formu, `FormActionBar`, `InlineTabbedPanel` (KISMEN: 24 popup kaldı, bkz. T-17) | FORMS_SPEC, DIALOG_ENVANTERI, ISLEM §2.2 | `components/ui/tabbed-form-shell.tsx` (~25 sayfa kullanıyor), `inline-tabbed-panel.tsx` |
| Y-13 | Tema/vurgu (Bordo, Petrol, Zeytin), yüksek kontrast, hareket token'ları, AnimatedNumber, palet görünüm komutları, `Kbd` | ARASTIRMA_TASARIM_ILHAMI, ARASTIRMA_ANIMASYON_UI | `app/themes.css`, `app/motion.css`, `components/ui/animated-number.tsx`, `lib/palette-core.ts` |
| Y-14 | Admin: Ofis 360, ofis ekleme (sekmeli), personel/duyuru sekmeli formlar, Marka | ISLEM (P0-13) | `app/admin/tenants/yeni/office-form.tsx`, `admin/tenants/[id]/office-360-panels.tsx`, `admin/marka/` |
| Y-15 | Tanımlar tek kaynak; kayıp nedeni ve aşama etiketi (şemasız çalışır, seed opsiyonel) | FEATURE_BACKLOG #1-2, PERSONA_OFIS #6, YOL_V2 §5 | `lib/definition-defaults.ts` (7 kayıt), `lib/loss-reason.ts`, `lib/deal-stage-labels.ts`, `app/raporlar/page.tsx` |
| Y-16 | Tam dışa aktarma (akışlı CSV) | YOL_V2 | `app/api/export/[entity]/route.ts` |
| Y-17 | Ayarlar'daki kopya kartlar silindi (10 kart kaldı) | MODUL_ENVANTERI §4.1 #8 | `app/ayarlar/page.tsx` |
| Y-18 | Ölü kütüphaneler silindi (`rent-increase.ts`, `tapu-cost.ts` yok); `COMMISSION_CAP_PCT` tek tanıma bağlandı | MODUL_ENVANTERI §5 #8-9, #3 | `lib/contract-risk.ts:74` (`= DEFAULT_SALE_CAP_RATE`) |
| Y-19 | Çağrı kaydı → Gelen Kutusu sekmesi, Eşleştirme → Talepler sekmesi, Ekip performansı, Raporlar kabuğu, Otomasyon kabuğu, Finans (Komisyon+Kazanç+Onaylar) sekmeleri | MODUL_ENVANTERI §4.3 | `nav-config.ts` `NAV_ALIASES` + `tabs`; `app/arama`, `app/eslestirme` yönlendirir |
| Y-20 | Randevuda "başka zaman öner", malik portalı `portal-kit` | PERSONA_MUSTERI #1, #12 | `actions/appointments-suggest.ts`, `app/randevu-teyit/[token]/confirm-buttons.tsx`, `app/malik-portali/[token]/page.tsx` |
| Y-21 | Hız turu (font preload, kök loading kaldırma, tur CLS, kabuk lazy) | HIZ_OLCUM_RAPORU_1-3 | Ölçüm belgeleri; kod bu turda ayrıca okunmadı. HIZ_3 mobil `/app` CLS 0,024; QA_3'teki 0,159 daha eski commit'e aittir (ÇÖZÜLDÜ sayıldı) |
| Y-22 | Telefon alanı görsel düzeltmeleri, rol etiketleri lig, kaynak etiketleri, çift kayıt uyarı gizliliği | QA_CANLI_RAPOR_1-3 | QA_3 "Önceki bulguların durumu" tablosu (canlı doğrulama); kod örneklemesi: `ui/phone-input.tsx` |
| Y-23 | Sayfa bazlı paket kilidi, kurulum yüzdesi tek kaynak | ROADMAP | `lib/billing/page-gates.ts`, `lib/onboarding-checklist.ts` |

Not: QA_CANLI_RAPOR (1), (2), HIZ_OLCUM_RAPORU (1), (2), DASHBOARD_YERLESIM_DENETIMI, ERISILEBILIRLIK_RESPONSIVE bulguları sonraki commit'lerle kapandı (git: 7f53bda, 73cea0d, 4660b0f, ff3d687, c24925f); kalan açıkları T-13'te.

### 2.2 DEVAM EDİYOR (başka ajanlarda; tekrar önerilmez)

| ID | Paket | Ne yapıyor (kaynak: ISLEM §4 ve görev tanımı) | Bu belgeden notu |
|---|---|---|---|
| AJ-01 | K1 admin üye/personel/sistem | P1-A1, A5, A6, A7, A8, A9, A12, A13 | Dalda `20260816010100_default_trial_days_setting.sql` var (M-20); K2 ile çakışıyor (O-12) |
| AJ-02 | K2 faturalama/plan/kupon/plan okuyucu + yeni fiyat kataloğu | P1-A2, A3, A4, A10, A11, A14 | Dalda 3 migration (M-21..M-23). `PRICING.md`/`DECISIONS.md` fiyatı (990/2490/5990/12900) yeni katalogla değişecek; `plans.ts` tek kaynak olmaya devam etmeli |
| AJ-03 | K3 müşteri/talep/iletişim | P0-1, P0-2, P1-C1..C9 | P0-1 hâlâ açık (`musteriler/[id]/page.tsx:177` `tab === "dosyalar"`, sekme kimliği `belgeler`) |
| AJ-04 | K4 portföy/proje/portal/KVKK belge görseli | P0-6..9, P1-D1..D8 | Dalda `20260818000400_property_media_is_document.sql` (M-24): önce migration, sonra kod |
| AJ-05 | K6 ayarlar/iş takibi/finans | P0-3,4,5,10; P1-B1,B6..B10, E1..E10, F7 | `komisyon/**`, `cuzdan/**`, `hedefler/**` K6'da: Faz 2 kodu (U-03) K6 bitmeden başlamaz |
| AJ-06 | Telefon girişi (ülkeye özel doğrulama) | PhoneInput/phone.ts | **M-01 (`20260814000100`) bu işin deploy'undan ÖNCE uygulanmalı** |
| AJ-07 | TV modu | `app/pano-tv`, `app/tv-mode.tsx` | `pano-tv` zaten `loadAdvisorMetrics` kullanıyor; tek veri kaynağı bozulmamalı |
| AJ-08 | Demo (is_sample) public sızıntı P0 | DANISMAN_UZMANLIK §5.6 | M-18 (`20260816001600`) bu işin parçası olabilir; sahibin kararı #5 |
| AJ-09 | Ücretsiz araçlar `/araclar` | ORGANIK Paket C | Henüz `src/app/araclar` yok (main'de); TÜFE doğrulama kapısı G-04 |
| AJ-10 | Modüller (aç/kapa) + menü 41→36 | ONERI_LISTESI §2.3, §4 | Dalda `20260816001700_tenant_modules.sql` (M-19). `nav-config.ts`, `permissions.ts`, `layout.tsx`, `palette-core.ts` ortak dosyaları şimdilik YALNIZ bu paketin |
| AJ-11 | SEO robot modülü | - | Kapsamı doğrulanamadı |
| AJ-12 | K5 ofis hesabı/abonelik/ekip/şube/profil/uyum | P0-11, P0-12, P1-B2..B5, F1..F6, F8 | K2 bitince başlar. Bu belgenin SIRADA maddeleri U-25, U-26 K5'in dosyalarındadır |

### 2.3 Operasyon ve canlı güvenlik

| ID | Madde | Kaynak | Durum | Değer | Risk | Efor | Şema | Bağımlılık / not |
|---|---|---|---|---|---|---|---|---|
| O-01 | Telefon CHECK'i yabancı numara + sabit hat kabul etsin (`20260814000100`) | QA_3, migration başlığı, `lib/phone.ts:14,153` | MİGRATION BEKLİYOR | Y | D | S | var | Canlıda eski CHECK `^05\d{9}$` (`20260722000015:63,69`, NOT VALID ama yeni yazmada sınanır): yabancı/sabit hat kayıt hatası riski. Canlı DB'ye bakılmadı: doğrulanamadı |
| O-02 | Kampanya teslimat claim `23514` düzeltmesi (`20260816001100`) | QA_3 YENİ-2, CAMPAIGN_DELIVERY_FIX | MİGRATION BEKLİYOR | Y | D | S | var | Kod dayanıklılığı yapıldı (`lib/campaign-delivery.ts:535`); CHECK + `claim_campaign_delivery` migration olmadan düzelmez. Uygulanınca bozuk eski WhatsApp kampanyaları `failed` olur |
| O-03 | Kazanç gizliliği DB katmanında (`20260816000500`) | FAZ2_MIGRATIONS, DENETIM_2 B1/B6 | MİGRATION BEKLİYOR (kod önce) | Y | Y | M | var | Etki taraması + rol smoke'u; M-07 |
| O-04 | Restore edilebilir yedek / PITR doğrulaması + restore provası | ROADMAP P0, DEPLOY, `runbooks/RESTORE.md` | SAHİBİN İŞİ | Y | Y | M | - | TÜM migration gruplarının ön koşulu |
| O-05 | Secret döndürme, Git geçmişi temizliği | ROADMAP P0, DURUM | SAHİBİN İŞİ (ajan dokunmaz) | Y | Y | M | - | Hafıza notu: ajanlar canlı env/secret'a dokunmaz |
| O-06 | Yayın öncesi: `PLATFORM_MFA_ENFORCEMENT=on`, demo kartlarını kapat | DURUM, DEPLOY | SAHİBİN İŞİ (sert güvenlik, onaysız eklenmez) | Y | Y | S | - | Şu an bilinçli kapalı |
| O-07 | Canlı RLS çapraz-tenant testi (izole test DB) | YOL_V2, ROADMAP | SIRADA (test DB sahibin) | Y | O | M | - | `db:rls-audit` statik/DB denetimi var; çapraz-tenant davranış testi yok |
| O-08 | Eski randevu kayıtları UTC yorumlanmış olabilir (3 saat kayma) | DURUM | SAHİBİN KARARI (veri düzeltmesi) | O | O | S | hayır | Yazma yolu +03:00 düzeltildi; eski satırlar için onay bekliyor |
| O-09 | Tapu/yetki belgesi görseli public sızıntısı (KVKK) | ISLEM P0-9 | DEVAM EDİYOR (K4) | Y | Y | M | var (dalda) | M-24 önce migration |
| O-10 | Demo (is_sample) verinin vitrin/portal/dış gönderime sızması | DANISMAN_UZMANLIK §5.6 | DEVAM EDİYOR | Y | Y | M | M-19 | - |
| O-11 | Askıdaki ofis ödeme sayfasına ulaşamıyor | ISLEM P0-12 | SIRADA (K5, K2'den sonra) | Y | O | S | hayır | `lib/supabase/middleware.ts`, `tenant-guard.ts` K5 |
| O-12 | Deneme günü çatışması: K1 `platform_default_trial_days()` (anahtar `default_trial_days`) ve K2 `billing_trial_days()` (`billing.plan_definitions`.trialDays) AYNI iki fonksiyonu (`provision_registration`, `convert_demo_request_to_tenant`) yeniden tanımlıyor | bu belge (dal incelemesi) | SAHİBİN KARARI + koordinasyon | Y | Y | S | var | Tek kaynak seçilmeli; öneri bölüm 6 K-2. Biri atılır ya da diğerine delege eder |
| O-13 | DB perf indeksleri (`proposed/20260814_perf_indexes*.sql`) | DB_PERF_RAPORU(_2) | ERTELENDİ | D | D | S | var | Etki ölçekli veride bekleniyor ve doğrulanmadı; ana neden RLS fonksiyon maliyetiydi (yapıldı). `14b` ilkinin YERİNE geçer |
| O-14 | Test/build/lint durumu | DURUM ("çalıştırılmadı") | DOĞRULANAMADI | - | - | - | - | Dalga başında `type-check`, `lint`, `test`, `build` koşulmalı |

### 2.4 Ürün işlevleri (birleştirilmiş; her satır birden çok belgenin aynı önerisidir)

| ID | Madde | Kaynak belge(ler) | Durum | Değer | Risk | Efor | Şema | Bağımlılık / not |
|---|---|---|---|---|---|---|---|---|
| U-01 | ISLEM P0 listesi (12 madde) | ISLEM §3.1 | DEVAM EDİYOR (K3: P0-1,2; K4: 6,7,8,9; K5: 11,12; K6: 3,4,5,10) | Y | O | M-L | kısmen | P0-1 kodda hâlâ açık (AJ-03) |
| U-02 | ISLEM P1 (59) + P2 (~45) | ISLEM §3.2-3.3 | DEVAM EDİYOR / K5 SIRADA | O-Y | D-O | L | az | Paketlere dağıtıldı; burada tekrar listelenmez |
| U-03 | Komisyon payı `profile_id`'ye bağlanır (`commission_splits` çift yazım), danışman planı/kademe/cap, hakediş (ödeme yaşam döngüsü) ekranı | FAZ2_MIGRATIONS, ADVISOR §3d/§7, PERSONA_DANISMAN #8, ISLEM P1-E3, DENETIM_2 B7 | MİGRATION BEKLİYOR | Y | O | L | M-04..M-06 (+M-07, O-03) | K6 dosyaları; `advisor-share.ts` etiket eşlemesi (`s.label === fullName`) ancak bununla biter |
| U-04 | Yapılandırılmış talep alanları + müşteri+talep tek işlem (`create_customer_with_demand`) | ADVISOR §3a/§7, FAZ2 | MİGRATION BEKLİYOR | Y | D | M | M-08, M-09 | `actions/customer-with-demand.ts` bugün iki ardışık insert; K3 |
| U-05 | Hedefler: randevu/portföy/talep hedefi | ADVISOR §7.4 | MİGRATION BEKLİYOR | O | D | S | M-10 | `targets.actual_*` doldurma yolu yok (gerçekleşme canlı hesaplanıyor) |
| U-06 | Otomatik atama kuralları (ağırlık, yedek zinciri, kapasite, SLA) | ADVISOR, FAZ2, ISLEM P1-B7, FEATURE_BACKLOG #6 | MİGRATION BEKLİYOR | Y | O | M | M-11 (+M-14 ilan hedefi) | `lead-intake.ts::pickAssignee` bugün "en az yüklü" |
| U-07 | Danışman uzmanlık/bölge/iş profili/kimlik (PII şifreli) formu | DANISMAN_UZMANLIK §4, §7 P-UZMAN | MİGRATION + SAHİBİN KARARI (PII anahtarı) | O | O | L | M-15, M-16 | TC/IBAN yalnız anahtar kararı sonrası |
| U-08 | İlan havuzu (puan, claim/SLA, öneri, cron `havuz-atama`) | DANISMAN_UZMANLIK §3, P-HAVUZ | MİGRATION + SAHİBİN KARARI | O-Y | O | L | M-14, M-17 | `check:cron` sayısı 27→28 (CLAUDE.md günceli) |
| U-09 | Demo ofis paketleri, banner, "Gerçek kullanıma başla" | DANISMAN_UZMANLIK §5, P-DEMO | MİGRATION + DEVAM EDİYOR (P0) | O | Y | L | M-18 | Demo danışman için `createAdminClient` kabulü sahibin kararı |
| U-10 | Kurulum turları (modül turları, sihirbaz adımları) | DANISMAN_UZMANLIK §6, P-TUR | SIRADA (son) | O | D | M | hayır | `ProductTour` motoru genişler, ikinci motor yok; hedef sayfalar oluştuktan sonra |
| U-11 | Modüller (aç/kapa) | ONERI_LISTESI §4, Ö-1 | DEVAM EDİYOR | Y | O | L | M-19 (dalda) | Kod migration'dan önce de yayınlanabilir (tablo yokken hepsi açık) |
| U-12 | Lead hızı: ilk yanıt süresi ölçümü + sahibe istisna bildirimi | ONERI Ö-3, FEATURE_BACKLOG #6, PERSONA_OFIS #8, YOL_V2 Faz 3 (4 belge → 1) | SIRADA | Y | D | M | hayır | `lib/lead-speed/**` yeni; ölçülemeyen "veri yok" yazar. `gamification-query.ts:296` null alanı bununla dolar |
| U-13 | Yetki belgesi: göster (K4 P0-8) + bitiş uyarısı/otomasyon/ana ekran sayacı + EİDS takip alanı ("kayıtlı bilgi", doğrulama iddiası yok) | ISLEM P0-8, FEATURE_BACKLOG #4, PERSONA_OFIS #2, ONERI Ö-5, PIYASA §3.0 (5 belge → 1) | DEVAM EDİYOR (gösterim) + SIRADA (uyarı) | Y | D | S-M | hayır (alan var: `properties.authorization_*`) | Danışman belgesi (`advisor_profiles.authority_cert_expires_on`, M-15) AYRI kavram: bkz. bölüm 5 "yetki" |
| U-14 | Müşteri ısısı: 4 skor motorunun (`lead-score`, `customer-heat`, `churn-risk`, `seller-prediction`) tek açıklamalı gösterimi + hazır akıllı listeler | ONERI Ö-2 | SIRADA | O-Y | D | M | hayır | Formül ekranda; "AI skoru" adı yasak (sahte skor kuralı) |
| U-15 | AI cevap taslağı (gelen WhatsApp/SMS), toplu eşleşme gönderimi, asistana talep sorgu aracı | ONERI Ö-4 | SIRADA | Y | O | M | hayır | Yalnız `ai/openai-client.ts` + `redact.ts`; insan gönderir. UI `gelen-kutusu/**` K3'ten sonra |
| U-16 | Doğal dil motoru ("yazdığını anlayan" arama + hızlı kayıt) | PIYASA F2/Paket B | SIRADA | Y | O | M | hayır | Çekirdek lib + `app/hizli` yüzeyi; palet K-Modüller sahibi |
| U-17 | Fotoğraf kalite denetçisi (deterministik) | PIYASA F3/Paket C | SIRADA | O | D | S-M | hayır | Lib + test; UI `portfoyler/**` K4 sonrası |
| U-18 | Malik-müşteri bağı (`properties.owner_customer_id`) | ONERI Ö-5 | MİGRATION BEKLİYOR (yeni, yazılmadı) | O | D | M | 1 kolon | FK adıyla gömme (`postgrest-embed-hint-contract`) |
| U-19 | Evrak toplama linki + tapu görselinden ön-doldurma | PIYASA F4/Paket D, ONERI Ö-5 | SIRADA (K4 `is_document` sonrası) | O | O | M | token tablosu | TEK belge hattı: evrak linki yüklemeyi Belge Merkezi'ne düşürür (bölüm 6 K-9) |
| U-20 | Mahalle pazar notu + pazar istatistiği (n eşikli) | PIYASA F5, ONERI Ö-8 | SAHİBİN KARARI (n eşiği) | O | O | M | küçük | Kod `region_stats_history`'yi kullanır |
| U-21 | MASAK müşteri tanıma defteri | PIYASA F1/Paket A | SAHİBİN KARARI (kapsam metni hukukçu teyidi) | O-Y | Y | M | `aml_cdd_records` | TC tutulmaz; "uyum karnesi" olarak sunulur, "yok" iddiası yapılmaz |
| U-22 | Gösterim sonrası geri bildirim, Google yorum köprüsü, satış sonrası playbook, malik portalı sayaç kartı | ONERI Ö-7, PIYASA F6, PERSONA_MUSTERI #2,#3 | ERTELENDİ (V3) | O | D | M | küçük | - |
| U-23 | Müşteri portalı: kiracı bölümü, iletişim tercihi, komisyon şeffaflık kartı, tek token | PERSONA_MUSTERI #4-#11, (b) | ERTELENDİ | O | O | L | evet | `kiralama`/`aidat`/`odeme-link` çakışma riski yüksek |
| U-24 | Ofis finans özeti (aylık: beklenen/tahsil/pay/gider/net) | PERSONA_OFIS #4 | SIRADA (K6 sonrası) | Y | O | M | hayır | Komisyon sekmesi olarak; U-03 ile birlikte tasarlanır (M-07 etkisi) |
| U-25 | Danışman çıkış (offboarding) sihirbazı + devir genişletme (talep, görev, randevu, açık anlaşma; zorunlu gerekçe var) | PERSONA_OFIS #3, PERSONA_DANISMAN #12, DENETIM_2 B5, ADVISOR §7.7 | SIRADA (K5) | Y | O | M | hayır | `ekip/devir`, `member-handoff.tsx` genişler |
| U-26 | Uyum karnesi tek ekran, memnuniyet uyarısı, vekâlet/onay eşiği | PERSONA_OFIS #9-#11 | SIRADA (K5/K6) | O | D | S-M | küçük (eşik) | `uyum` sayfası K5 |
| U-27 | Mobil: sabit eylem şeridi (Ara/WhatsApp/Not/Randevu), çevrimdışı yazma kuyruğu | PERSONA_DANISMAN #4, #6, §7 | SIRADA (şerit S) / ERTELENDİ (kuyruk L) | O | D-O | S / L | hayır | sw.js fail-closed korunur |
| U-28 | Özel alanlar v1, özel pipeline aşamaları/etiket | FEATURE_BACKLOG #10, YOL_V2 §5 | ERTELENDİ (en yüksek mimari risk; tasarım ayrı tur) | O | Y | L | evet | - |
| U-29 | Emlakfiyati arayüz sınırı (iskelet + sözleşme testi) | ONERI Ö-6 | DIŞ (API belgesi gelene dek yalnız sözleşme) | O | D | S | hayır | Sahibin sağlaması: ONERI §3.2 |
| U-30 | WhatsApp çift yönlü gelen kutusu, portal XML/API, e-imza sağlayıcı, e-fatura, açık bankacılık, TKGM | ROADMAP DIŞ, PIYASA K1-K10, ONERI §7 | DIŞ | Y | Y | L | - | Dalga 3 |
| U-31 | İçe aktarma: talep/not kapsamı genişletme | FEATURE_BACKLOG #5 | SIRADA (K3) | O | D | M | hayır | Geri alma/mükerrer planı yapıldı (62576d4); talep/not kapsamı doğrulanamadı |
| U-32 | Mevzuat parametreleri (süper admin + ofis override) tasarımı | YOL_V2 §5, TURKIYE_UYUM | ERTELENDİ (tasarım turu) | O | O | M | evet | TÜFE/harç/faiz verisi sahibin doğrulamasına bağlı (G-04, bölüm 7 #10) |

### 2.5 Büyüme (organik)

| ID | Madde | Kaynak | Durum | Değer | Risk | Efor | Şema | Not |
|---|---|---|---|---|---|---|---|---|
| G-01 | Kaynak/UTM yakalama + admin rapor (Paket H) | ORGANIK §3.9 | MİGRATION BEKLİYOR (taslak) | O-Y | D | M | `proposed/…growth…` | Sıra 1 (ORGANIK §9) |
| G-02 | Referral ofis→ofis (Paket A) + hesap kredisi defteri | ORGANIK §3.1-3.2 | MİGRATION + SAHİBİN KARARI | Y | O | L | aynı taslak | Kredi ≠ K2 kuponu (bölüm 6 K-4) |
| G-03 | Ortaklar/affiliate (Paket B), token'lı rapor | ORGANIK §3.3 | SAHİBİN KARARI (hukukçu/mali müşavir) | O | Y | L | aynı taslak | İlk sürüm nakit yok |
| G-04 | Ücretsiz araçlar `/araclar` (Paket C) | ORGANIK §3.4 | DEVAM EDİYOR | Y | O | M | hayır | Kira artışı aracı TÜFE doğrulanana dek yayına AÇILMAZ; kredi faizi varsayılanı 2,79 "örnek" etiketli olmalı (`lib/purchase-costs.ts:136`) |
| G-05 | Danışman/ofis sayfası rızası, `index_allowed`, "Powered by" kısa ref (Paket D) | ORGANIK §3.5 | SIRADA (şema küçük) | O | O | M | küçük | Sitemap opt-in kararı sahibin (#6 ORGANIK) |
| G-06 | 30 günlük başarı programı + ücretsiz taşıma talebi (Paket E) | ORGANIK §3.6 | SIRADA | O | D | M | küçük (ticket kategorisi) | E-posta İYS/ETK |
| G-07 | Başarı hikâyesi, benchmark (Paket F, G) | ORGANIK §3.7-3.8 | ERTELENDİ (≥10 ofis, izin kaydı) | D | O | M | evet | - |
| G-08 | SEO robot modülü | görev tanımı | DEVAM EDİYOR | - | - | - | - | - |

### 2.6 Tutarlılık ve teknik borç (bölüm 5'in aksiyonları)

| ID | Madde | Kaynak | Durum | Değer | Risk | Efor | Not |
|---|---|---|---|---|---|---|---|
| T-01 | Tek terim sözlüğü (`lib/terminology.ts`) + yasaklı varyant sözleşme testi | SADELIK §8, bu belge §5.1 | SIRADA | Y | D | S-M | Dalga 1 |
| T-02 | Rol etiketleri tek kaynak (`lib/role-labels.ts`; 8 yerel kopya) | bu belge §5.2 | SIRADA | O | D | S | Dalga 1 (lib) + çağrı noktaları sahibine |
| T-03 | Ay/gün sınırı: `clock.ts` TR ay yardımcısı; UTC/yerel kopyalar kalksın | DENETIM_2 B8, bu belge §5.2 | SIRADA | Y | D | S | Dalga 1 |
| T-04 | Para/tarih biçimi: `lib/format.ts` yayılımı + yeni kopyayı yasaklayan sözleşme | MODUL_ENVANTERI §5 #1-2 | SIRADA | O | D | M | Kademeli, sahibine göre |
| T-05 | Durum/aşama etiket sözlükleri (40 yerel sabit) | MODUL_ENVANTERI §5 #5 | SIRADA | O | D | M | `status-labels.ts` + `deal-stage-labels.ts` |
| T-06 | UI bileşen aileleri tekleme (empty-state ×3, stat ×2, skeleton ×2, sekme/panel ×7, tablo ×2) | MODUL_ENVANTERI §5 #12, YOL_V2 | SIRADA | O | O | L | Çağrı noktaları K-paketleri bitince |
| T-07 | `tasks` ve `customers` insert için tek kurucu (6 + 6 yer) | MODUL_ENVANTERI §5 #10-11 | SIRADA | O | O | M | Telefon/e-posta doğrulaması + mükerrer tek yerde |
| T-08 | WhatsApp bağlantı tek kaynak (`wa.me` 12 satır/7 dosya; `whatsapp-link.ts` hâlâ var) | MODUL_ENVANTERI §5 #6, YOL_V2 | SIRADA | D | D | S | - |
| T-09 | Otomasyon ve playbook motorlarının ortak görev üreticisi | MODUL_ENVANTERI §4.1 #6 | ERTELENDİ | O | O | M | Sayfa birleşimi yapıldı, motorlar ayrı |
| T-10 | Duyuru ailesi (4 yapı: announcements, notifications, platform_announcements, platform_notifications) | MODUL_ENVANTERI §4.1 #7 | ERTELENDİ | D | O | M | Ofis duyurusu `bildirimler?sekme=duyurular` yapıldı |
| T-11 | "Yeni müşteri" 21 giriş noktası / 2 form yolu | SADELIK §8, bu belge §5.2 | SIRADA | O | D | S | Karar: bölüm 6 K-6 |
| T-12 | Belge temizliği ve güncelleme | bu belge §8 | SIRADA | Y | D | S | Dalga 1 (yalnız docs) |
| T-13 | Kalan UI P2/P3: StatRow/StatCard etiketi kelime ortasından kırılıyor, `/baslangic` 390px taşma 119px, boş sabit alt çubuk (vitrin), ham `paid`/JSON özet, podyum tek kişi, eski koyu hero bandı (14 sayfa) | QA_3 YENİ-1,4..13, DURUM | SIRADA | O | D | M | `components/ui/stat-row.tsx` K-paketlerinde değil: Dalga 1 |
| T-14 | `phoneSchema`/`emailSchema` kontrat boşluğu (CLAUDE.md `validation/contact.ts` diyor) | MODUL_ENVANTERI §5.2 | KISMEN | D | D | S | `lib/admin/office-create-input.ts` `emailSchema` kullanıyor; telefon yolu `parsePhone`. Cümle CLAUDE.md'de düzeltilmeli |
| T-15 | Popup'tan sayfa-içi paneline geçmeyen 24 ekle/düzenle dosyası | ISLEM §2.2 | DEVAM EDİYOR (K-paketleri) | O | D | M | - |
| T-16 | `docs/design/agent-taslaklari/` = `.claude/agents/` kopyası | bu belge | SIRADA | D | D | S | Biri silinmeli (öneri: docs kopyası) |

---

## 3. ÖNCELİKLİ DALGALAR

Kural: bir paket yalnız kendi klasörlerini değiştirir; K1-K6, Modüller, telefon, TV, demo P0, /araclar ve SEO paketlerinin dosyalarına dokunmaz.
Ortak dosyalar (`nav-config.ts`, `permissions.ts`, `app/layout.tsx`, `palette-core.ts`, `app-sidebar.tsx`, `vercel.json`, `admin-client-allowlist.ts`):
şu an Modüller paketinindir; ondan sonra tek tek sırayla.

### Dalga 1 (şimdi; şemasız; K-paketleriyle çakışmaz)

Dosya sahipliği yalnız YENİ klasör/dosyalardır; mevcut dosyalara entegrasyon "çağrı noktası" olarak ilgili K-paketinin bitişinden sonra yapılır.

| Paket | İçerik (backlog) | Sahip olduğu dosyalar | Dokunmaz |
|---|---|---|---|
| W1-A Tek kaynak yardımcılar | T-02, T-03, T-04 (yalnız yardımcı + sözleşme testi), T-08 | `lib/role-labels.ts`, `lib/clock.ts` (ay yardımcısı ekleme), `lib/format.ts`, `lib/whatsapp-link.ts` silme, yeni `lib/*-contract.test.ts` | Çağrı noktalarındaki sayfalar (sahiplerinin işi) |
| W1-B Terim sözlüğü | T-01 | `lib/terminology.ts`, `lib/help-content.ts` (GLOSSARY'yi bundan türet), `lib/terminology-contract.test.ts` | Sayfa metinleri |
| W1-C Lead hızı | U-12 | `lib/lead-speed/**`, `app/raporlar/lead-hizi/**` (kart olarak `app/raporlar/page.tsx`'e tek satır) | `nav-config.ts` (sekme eklenmez) |
| W1-D Müşteri ısısı | U-14 | `lib/customer-intel/**`, `app/akilli-listeler/hazir-listeler.ts` (K3 `akilli-listeler/**` sahibi: koordine) | Mevcut skor dosyaları değişmez |
| W1-E AI cevap taslağı (lib/action) | U-15 | `lib/ai/reply-draft.ts`, `actions/reply-draft.ts`, `lib/ai/tools/search-demands.ts` | `gelen-kutusu/**` UI (K3 sonrası) |
| W1-F Doğal dil motoru | U-16 | `lib/nl/**`, `app/hizli/**` yüzeyi | palet (Modüller) |
| W1-G Foto kalitesi | U-17 | `lib/photo-quality/**` | `portfoyler/**` UI (K4 sonrası) |
| W1-H Ortak UI düzeltmeleri | T-13 | `components/ui/stat-row.tsx`, `ui/phone-input.tsx` değil (telefon ajanı), `app/baslangic/**` (taşma) | K paketlerinin sayfaları |
| W1-I Belge temizliği | T-12, T-16 | `docs/**`, `CLAUDE.md` | kod |

### Dalga 2 (migration grupları uygulandıktan sonra; bölüm 4)

| Paket | İçerik | Ön koşul migration | Dosya sahipleri |
|---|---|---|---|
| W2-A Faz 2 pay/plan/hakediş | U-03, U-24, U-05, O-03 | G2 (+ G3 ayrı pencere) | K6 bitince: `komisyon/**`, `cuzdan/**`, `hedefler/**`, `lib/commission*.ts`, `lib/team/advisor-share.ts` |
| W2-B Talep alanları | U-04 | G2 (M-08, M-09) | K3 bitince: `musteriler/yeni`, `talepler/**`, `actions/customer-with-demand.ts` |
| W2-C Atama kuralları | U-06 | G2 (M-11) | `ayarlar/lead/**`, `lib/lead-intake.ts` |
| W2-D Uzmanlık/kimlik | U-07 | G4 (M-15, M-16) + PII kararı | `ekip/yeni/**`, `ekip/[id]/**` (K5 sonrası), `lib/advisor/**` |
| W2-E İlan havuzu | U-08 | G4 (M-14, M-17) | yeni `app/havuz/**`, `lib/pool/**`, `api/cron/havuz-atama` |
| W2-F Demo ofis + tur | U-09, U-10 | G4 (M-18) + demo P0 paketi bitmiş | `lib/sample/**`, `actions/sample-data.ts`, `lib/tours/**` |
| W2-G Organik büyüme | G-01, G-02, G-03, G-05, G-06 | G8 (growth, yeniden numaralı) + K2 bitmiş | `lib/growth/**`, `app/ayarlar/davet-et`, `admin/ortaklar/**` |
| W2-H Malik bağı, evrak linki | U-18, U-19 | `is_document` (M-24) uygulanmış | `lib/property-owner/**`, yeni evrak yolu |
| W2-I Bileşen/kopya geçişleri | T-04..T-07 çağrı noktaları, T-11 | K paketleri birleşmiş | Her sahibin kendi klasörü, sıralı |
| W2-J K5 + sonrası | U-25, U-26, O-11 | K2 bitmiş | `ekip/**`, `uyum/**`, `abonelik/**`, `askida/**` |

### Dalga 3 (dış hesap / anlaşma / hukuk)

U-29 Emlakfiyati; U-30 (WhatsApp Business/BSP, portal API, e-imza sağlayıcı, e-fatura, açık bankacılık, TKGM); U-21 MASAK kapsam teyidi; G-03 ortak ödül sözleşmesi; KVKK/İYS metinleri ve danışman kişisel veri aydınlatması (hukukçu); EİDS resmi erişim. Kod değil, iş geliştirme/hukuk adımıdır (ORGANIK §5, ONERI §7).

### Dalga 4 (ertelenen / elenen)

ERTELENDİ: U-22, U-23, U-27 (çevrimdışı kuyruk), U-28 (özel alanlar), U-32, O-13 (indeksler), G-07, T-09, T-10.
ELENDİ (gerekçe kaynakta): rakip ilan takibi/fiyat alarmı/portföy avcısı (kazıma, ONERI §5), canlı danışman izleme ve arama kaydı analizi (gözetim), banka lead/kredi motoru, sesli komut, otonom WhatsApp ajanı, "AI lead skoru/tahmini kapanış/satılabilirlik skoru" (sahte skor yasağı), tek /100 danışman skoru, Chrome extension, "Verified Office" rozeti, hukuki sözleşme üretici, ChatGPT'nin 10 başlıklı menüsü, çevrimdışı sayfa önbelleği (fail-closed karar).

---

## 4. MİGRATION YÖNETİMİ

### 4.1 Durum özeti

- Depoda 197 dosya; son canlı uygulanan `20260813000300`. Sonrası 18 dosya `supabase/migrations/` içinde UYGULANMAMIŞTIR (sahibin bildirimi; canlı ledger bu turda sorgulanmadı, doğrulanamadı).
- Ek: 6 dosya ajan dallarında (main'de YOK), 3 dosya `supabase/proposed/` altında (migration değil).
- Statik denetim yeşil (197 dosya, checksum sağlıklı). 3 eski numara çakışması dondurulmuş istisnadır (`20260726000058`, `…087`, `…108`); yeni çakışma yok `migrations/` içinde.
- Her uygulanmamış dosyanın `supabase/rollbacks/*.rollback.sql` karşılığı var (rollback runner'a bağlı DEĞİL; elle/kontrollü; ters sırada).
- Sözleşme testleri: `faz2-migrations-contract.test.ts` (Faz 2), `migration-international-phone-contract.test.ts` (M-01). **Faz 3 için sözleşme testi ve `docs/design/FAZ3_MIGRATIONS.md` YOK** (DANISMAN_UZMANLIK §7 "P-MIGRATION" bunu vaat ediyor, yazılmamış): Dalga 2 öncesi yazılmalı.
- `deploy sırası`: önce DB, sonra kod (`docs/DEPLOY.md`). İki istisna aşağıda (M-19 kod-önce serbest, M-24 migration-önce zorunlu).

### 4.2 Tek sıralı liste (uygulama sırası = numara sırası; ajan dalı dosyaları sona eklenmiştir)

Sütun "Davranış": EK (additive, mevcut davranış değişmez), GEVŞETİR, DEĞİŞTİRİR. "Kod şema yokken": main'deki kodun şema olmadan durumu (koddan doğrulandı).

| Sıra | Dosya (migrations/) | Ne yapar | Bağımlılık | Davranış | Kod şema yokken | Geri alma |
|---|---|---|---|---|---|---|
| M-01 | `20260814000100_international_phone_constraints` | `customers_phone_tr_format`, `calls_phone_tr_format` CHECK'lerini `0XXXXXXXXXX` ve `+E.164` kabul edecek şekilde değiştirir (NOT VALID); `create_public_booking_atomic_state_v1` ve `create_public_booking_atomic` RPC'lerini yeniden tanımlar (yalnız telefon deseni; gövde canlıdan dökülmüş görünüyor, uygulama öncesi canlı gövdeyle fark kontrolü önerilir: doğrulanamadı) | yok | GEVŞETİR | KOD ŞEMAYI BEKLİYOR: `lib/phone.ts` yabancı ve sabit hat saklıyor; eski CHECK `^05\d{9}$` bunları reddeder (canlıyı doğrulamadım) | `rollbacks/20260814000100…` |
| M-02 | `20260815000100_loss_reason_stage_label_definitions` | `definitions` tablosuna global seed (kayıp nedeni, aşama etiketi); idempotent, şema değişmez | yok | EK | Çalışır: `definition-defaults.ts` fallback | rollback var |
| M-03 | `20260816000100_earnings_all_permission_defaults` | `permission_defaults` seed'i (`earnings_all`) | yok | EK (05 yoksa etkisiz; çalışma zamanı izinleri kod matrisinden gelir) | n/a | rollback var |
| M-04 | `20260816000200_commission_splits` | `commission_splits` + `faz2_touch_updated_at()`; backfill YOK | commissions, profiles | EK | Kod henüz yazmıyor/okumuyor | rollback var |
| M-05 | `20260816000300_advisor_commission_plans` | danışman planı (kademe, cap, ofis/referans/franchise payı) | M-04 (fonksiyon) | EK | Kod yok | rollback var |
| M-06 | `20260816000400_commission_payouts` | hakediş tablosu (pending → approved → paid), denetim trigger'ı, para alanları onaydan sonra değişmez | M-04 | EK | Kod yok | rollback var |
| M-07 | `20260816000500_commission_earnings_privacy` | `can_view_commission_earnings` (DEFINER), `commissions_select` politikası, `advisor_kpis` ciro maskesi | M-03, M-04 | **DEĞİŞTİRİR** (şube müdürü/takım lideri/danışman yalnız kendi komisyonunu görür) | Kod etkisi: `.from("commissions")` geçen 14 dosya, kullanıcı client'ı kullananlar daralır (`_home/data.ts`, `komisyon/page.tsx`, `anlasmalar/[id]/*`, `actions/commissions.ts`, `payment-links.ts`, `workflow.ts`, `audit-dossier.ts`, `export*.ts`, `ai-tenant-advisor.ts`, `advisor-metrics.ts`) daralır | rollback var (eski politika + `advisor_kpis` gövdesi) |
| M-08 | `20260816000600_customer_demand_structured_columns` | `customer_demands` ek sütunlar (döviz, kredi, takas, kat, bina yaşı, zorunlu anahtarlar) | yok | EK | Kod yok | rollback var |
| M-09 | `20260816000700_create_customer_with_demand_rpc` | `create_customer_with_demand` (SECURITY INVOKER) | M-08 | EK | `actions/customer-with-demand.ts` iki ardışık insert yapıyor; RPC'yi çağıran kod yok | rollback var |
| M-10 | `20260816000800_targets_activity_goals` | `targets` randevu/portföy/talep hedefi (3 sütun, DEFAULT 0) | yok | EK | Kod yok | rollback var |
| M-11 | `20260816000900_assignment_rules` | `assignment_rules` + `assignment_rule_members` | M-04 (trigger fonksiyonu) | EK | Kod yok (`pickAssignee` "en az yüklü") | rollback var |
| M-12 | `20260816001000_profiles_title_visibility_scope` | `profiles.title`, `visibility_scope` + guard trigger (kapsam yalnız `team:edit` ile değişir) | yok | EK (self_update yolunda yeni kısıt yalnız kapsam sütununa) | Kod yok | rollback var |
| M-13 | `20260816001100_campaign_claim_legacy_whatsapp_fix` | `campaigns_whatsapp_template_contract` terminal durumlara gevşetilir; `claim_campaign_delivery` yeniden tanımlanır; sözleşmeye uymayan WhatsApp kampanyaları `failed` + `last_error='whatsapp_template_invalid'` olur | yok | GEVŞETİR + veri değişimi (yalnız gönderim yapılmamış bozuk kampanyalar) | KOD ŞEMAYI BEKLİYOR: `campaign-delivery.ts` hata atıp cron'u kırıyor (QA_3) | rollback var |
| M-14 | `20260816001200_assignment_rules_listing_target` | `assignment_rules`'a hedef türü/ilan modu; `tenants.listing_pool_enabled` (varsayılan kapalı) | M-11 | EK | Kod yok | rollback var |
| M-15 | `20260816001300_advisor_profiles_private` | `advisor_profiles` (iş verisi), `advisor_private` (kimlik; TC/IBAN yalnız uygulama katmanı şifreli, son 4 hane); audit trigger yalnız alan adı yazar | M-04 (fonksiyon) | EK | Kod yok. PII anahtarı kararı gelmeden TC/IBAN girişi kapalı kalmalı | rollback var (kişisel veri silinir) |
| M-16 | `20260816001400_advisor_specialties_regions` | `advisor_specialties`, `advisor_regions`; global `advisor_segment` tanım seed'i | M-04 | EK | Kod yok | rollback var |
| M-17 | `20260816001500_listing_pool` | `listing_pool_entries`, `listing_pool_events`, `assign_pool_entry` (SECURITY DEFINER, `search_path` boş; claim/FOR UPDATE) | M-11, M-14 | EK | Kod yok | rollback var (`properties.assigned_to` kalır) |
| M-18 | `20260816001600_sample_data_scope_extension` | `is_sample` bayrakları (commissions, offers, contracts, rentals, calls, expenses, notifications, profiles), `tenants.sample_pack/sample_cleared_at`, kısmi indeks | yok | EK | Kod yok; demo sızıntı P0 paketi bununla ilişkili olabilir (doğrulanamadı) | rollback var |

Ajan dallarında (main'de YOK; numaralar bu belgenin yazıldığı andaki dal içeriğinden):

| Sıra | Dosya | Dal | Not |
|---|---|---|---|
| M-19 | `20260816001700_tenant_modules` | Modüller | Yeni tablo; RLS: ofis kendi satırını okur, yazma owner/gm ve platform kilidi olmayan satır; kod tablo yokken tüm modülleri açık sayar: kod önce yayınlanabilir |
| M-20 | `20260816010100_default_trial_days_setting` | K1 | `platform_default_trial_days()`; `provision_registration` ve `convert_demo_request_to_tenant` yeniden yazılır. **K2 M-22 ile çakışır (O-12)** |
| M-21 | `20260817000210_plan_business_and_pricing_support` | K2 | Business paketi + `plan_entitlements` yazma yetkisi; ilgili RPC'ler güncellenene dek Business satılmaz |
| M-22 | `20260817000220_trial_days_setting_and_price_lock` | K2 | `billing_trial_days()`; AYNI iki fonksiyonu yeniden yazar + Founders kilitli fiyat. **M-20 ile çakışır** |
| M-23 | `20260817000230_coupons` | K2 | `coupons` tablosu (yalnız service_role) |
| M-24 | `20260818000400_property_media_is_document` | K4 | `property_media.is_document`; **migration KODDAN ÖNCE zorunlu** (sütun yokken public medya sorguları hata verir, görsel göstermez) |

Not: M-19..M-24 numaraları dallar birleşirken değişebilir; birleştirme ajanı numara çakışmasını `check:migrations` ile yakalamalı. Bu belge dal içeriğini yalnız okudu.

Taslaklar (`supabase/proposed/`, migration DEĞİL, uygulanamaz):

| Dosya | Ne | Sorun | Çözüm |
|---|---|---|---|
| `20260816001200_growth_referral_partner_attribution.sql` (+ `rollbacks/` karşılığı) | growth_* tabloları, `account_credit_ledger`, ortaklar, `signup_attributions` | **`migrations/20260816001200_assignment_rules_listing_target` ile AYNI numara** (rollbacks klasöründe de iki `…001200…rollback.sql` var) | Taşınırken yeni numara: öneri `20260819000100` (tüm dal numaralarından sonra). Bağımlılık: K2 tablolarına dokunmaz |
| `20260814_perf_indexes.sql` | 10 indeks önerisi | 8 haneli ad `^\d{14}[a-z]?_` desenine uymaz; `CREATE INDEX CONCURRENTLY` runner'ın tek transaction'ında çalışmaz | `14b` ilkinin yerine geçer: İKİSİNİ BİRLİKTE UYGULAMA. Ertelendi (O-13) |
| `20260814b_perf_indexes_measured.sql` | 7 indeks (ölçüme göre daraltılmış) | aynı adlandırma/CONCURRENTLY sorunu | Ölçekli veri olmadan fayda doğrulanamadı |

### 4.3 Numara/sıra denetimi (sonuç)

1. `migrations/` içinde yeni çakışma YOK (statik denetim yeşil).
2. `proposed/…001200…` ↔ `migrations/…001200…`: ÇAKIŞMA (yukarıda).
3. Sıra hatası yok: tüm uygulanmamış dosyalar son uygulanan `20260813000300`'dan büyük; bağımlılık zincirleri numara sırasıyla sağlanıyor (M-05/M-11/M-15/M-16 → M-04; M-14 → M-11; M-17 → M-11+M-14; M-07 → M-03+M-04; M-09 → M-08).
4. `20260816001100` (kampanya) Faz 2 ile Faz 3 arasına girmiş; hiçbirine bağımlı değil, tek başına ve ilk uygulanabilir.
5. Dal numaraları: `20260816010100` (K1) `…001700`'den sonra, `20260817…`'den önce sıralanır; K1/K2 aynı fonksiyonları yazdığı için "sıra" davranışı belirler (son kazanır): bu bir numara hatası değil içerik çatışmasıdır (O-12).
6. Ledger/checksum: uygulanmış dosyalar değişmedi (statik denetim); `--database` kontrolü canlı DB gerektirir, yapılmadı.

### 4.4 Önerilen uygulama grupları ve her grup sonrası doğrulama

Her grup öncesi: (a) restore edilebilir yedek/PITR ve zaman damgası notu (O-04); (b) `npm run check:migrations`, `npm run check:migrations -- --database` (drift varsa DUR), `npm run db:migrate -- --dry-run` (yalnız o grubun dosyaları bekliyor olmalı); (c) `type-check` + `test` yeşil. Her grup sonrası: `npm run db:rls-audit`, `npm run check:migrations -- --database` (ledger'ın ilerlediği), `npm run test:e2e:public` (salt-okunur smoke), grup smoke'u.

| Grup | Dosyalar | Gerekçe | Grup sonrası smoke |
|---|---|---|---|
| G0 | M-01, M-13 | Davranış düzeltmesi (özellik değil); telefon ajanı ve kampanya cron'u buna bağlı | Yabancı numara ve sabit hatla müşteri kaydı (izole hesap), kamuya açık randevu alma; `/admin/sistem` cron özeti `campaign-delivery` sağlıklı; bozuk WhatsApp kampanyası `failed` görünür |
| G1 | M-02 | Salt seed, risksiz | Anlaşma kaybet diyaloğunda kayıp nedeni listesi; Ayarlar > Tanımlar |
| G2 | M-03, M-04, M-05, M-06, M-08, M-09, M-10, M-11, M-12 | Hepsi additive; 05 hariç; kod bağlanana dek etkisiz (M-12'de self_update yoluna küçük guard) | `faz2-migrations-contract.test.ts`; RLS audit yeni tabloları görür; `/app/cuzdan`, `/app/komisyon`, `/app/danisman-kpi` eskisi gibi; profil güncelleme (ad/telefon) çalışır |
| G3 | M-07 | AYRI PENCERE: tek davranış değiştiren | Önkoşul: (1) etki taraması: `komisyon/page.tsx`, `_home/data.ts`, `anlasmalar/[id]/*`, `payment-links.ts`, `commissions.ts`, `workflow.ts`, `audit-dossier.ts`, `export*`, `ai-tenant-advisor.ts` için rol bazlı (şube müdürü, takım lideri, danışman) beklenen sonuç yazılmış; (2) izole test DB'de önce uygulanmış; (3) DENETIM_2 B6'daki sayfalar `earnings_all` koşullu/DEFINER toplamaya taşınmış. Sonra smoke: 4 rol (owner, şube müdürü, danışman, muhasebe) ile Komisyon, Kazanç, Ana ekran, Anlaşma detayı, CSV, AI asistan; danışman başkasının anlaşma kimliğiyle komisyon okuyamaz. Eski kayıtlarda payı olup `assigned_to` olmayan danışman satırı görmez (backfill yok): cüzdan etkisi doğrulanamadı, test edilmeli |
| G4 | M-14, M-15, M-16, M-17, M-18 | Faz 3 yeni tablolar; M-15 PII anahtarı kararı sonrası kod; M-17 havuz kapalı (`listing_pool_enabled` varsayılan kapalı) | RLS audit: `advisor_private` yalnız owner/gm/kendisi; `assign_pool_entry` anon/authenticated yetkisi doğru; Faz 3 sözleşme testi (önce yazılmalı) |
| G5 | M-19 (Modüller) | Kod önce yayınlanabilir; sonra migration | Kapalı modül menüde yok; platform kilidi ofiste değişmez (RLS testi) |
| G6 | M-24 (K4 `is_document`) | Migration önce, kod sonra | Belge işaretli görsel vitrin/paylaşım/portal/OG/`/api/property-media`'da servis edilmez |
| G7 | M-20, M-21, M-22, M-23 (K1/K2) | O-12 çözülmeden uygulanmaz | Yeni kayıt deneme süresi; plan fiyatları; kupon (yalnız service_role) |
| G8 | growth taslağı (yeni numara) | K2 bitmiş ve sahibin ödül kararları sonrası | Kayıt `?ref=`; kredi defteri ekleme-yalnız |

### 4.5 Sahibin yapacakları (adım adım)

1. Supabase panelinde restore edilebilir yedek/PITR'ı doğrula; restore noktası zaman damgasını not et (`docs/runbooks/RESTORE.md`). Doğrulanmadıkça G0 dahil hiçbir grup uygulanmaz.
2. Bu belgeyi ve `FAZ2_MIGRATIONS.md` kontrol listesini oku; G0 kararını ver (düşük risk, en yüksek değer).
3. Yerelde `npm run check:migrations -- --database` ve `npm run db:migrate -- --dry-run` çalıştır; ledger drift varsa durdur, bana bildir.
4. Telefon ajanının kodunu yayınlamadan ÖNCE G0'ı uygula (ya da ajanın deploy'unu G0'a bağla).
5. Her grup: dry-run → `npm run db:migrate` → `npm run db:rls-audit` → smoke (tablodaki liste). Bir grubu uyguladıktan sonra bir sonrakine geçmeden ledger'ı yeniden kontrol et.
6. G3 (05) için ayrı bir gün seç; önce izole test DB'sinde dene; o ana kadar kod paketi (kazanç etki taraması) yayında olsun.
7. K1/K2 deneme süresi çatışması çözülmeden G7'yi uygulama (bölüm 6 K-2).
8. Gizli/anahtar işleri (PII anahtarı `ADVISOR_PII_KEY`, MFA bayrağı, demo kartları, secret döndürme) senin işindir; ajanlar dokunmaz.

---

## 5. KAFA KARIŞIKLIĞI VE MÜKERRER DENETİMİ

### 5.1 Terminoloji tutarsızlıkları (kullanıcıya görünen metinde; sayılar `src/app/app/**/*.tsx` ve `src/**/*.tsx` grep'idir, ham satır sayısı, kod tanımlayıcıları dahildir: ÇARPICI RAKAM DEĞİL, işaret olarak okuyun)

| Kavram | Bulunan adlar (kanıt) | Karar (tek sözlük) |
|---|---|---|
| Talep / aday / lead | `DECISIONS.md` "lead yok"; yine de kullanıcıya görünür: `app/musteriler/cift-kayit/page.tsx:113,171` ("lead istatistikleri", "portal lead'leri"), `app/ayarlar/entegrasyonlar/page.tsx:11` ("sosyal lead yakalama"); aynı ekran 3 adla: Ayarlar kartı "Aday yakalama" (`ayarlar/page.tsx:60`), `ekip/yeni/advisor-form.tsx:263` "talep ayarları", yol `/app/ayarlar/lead`, kamuya açık form yolu `/lead/[token]`. `lead` 101 satır/30 dosya (bir kısmı kod adı, bir kısmı `admin/satis` = platform satış adayı) | **Talep** = müşterinin aradığı (`customer_demands`). **Aday** = henüz müşteri olmamış gelen kişi (`lead-intake`). "Lead" kullanıcıya hiçbir yerde görünmez. Yol adları kalır (URL kırılmaz), metinler düzelir. Ayarlar kartı "Aday yakalama", advisor-form metni aynı ad |
| Portföy / ilan | `portföy` 601 satır/146 dosya, `ilan` 91 satır/37 dosya (/app) | **Portföy** = ofisin kaydı (iç dil); **İlan** = vitrinde/portalda yayındaki hali. İç ekranlarda "ilan" yalnız yayın bağlamında |
| Anlaşma / fırsat / satış | `fırsat` 15 satır/9 dosya (pazarlama, `kayip-satis`, asistan); "satış" hem portföy işlem türü (Satılık) hem platform satışı (`/admin/satis`) hem "Kayıp satış" | /app'te **Anlaşma**. "Satış" yalnız işlem türü ve /admin satış CRM'i. "Fırsat" kullanıcıya görünmez |
| Danışman / üye / personel / kullanıcı | `danışman` 302 satır/88 dosya; `üye|personel|çalışan` 26/12; /admin'de "Personel" (platform_staff) ayrı kavram | **Danışman** = saha rolü; **Ekip üyesi** = tüm roller; **Personel** yalnız /admin (platform çalışanı); **Kullanıcı** = giriş hesabı. "Çalışan yönetimi" sayfa adı kalkar (SADELIK §8) |
| Komisyon / pay / kazanç / hakediş / cüzdan | Tek sayfa dört adla: menü sekmesi "Kazanç" (`nav-config.ts:138`), yol `/app/cuzdan`, boş durum "Cüzdanın henüz boş" (`cuzdan/page.tsx:341`), eyebrow "Kişisel hakediş" (`:192`). `hakediş` 21 satır/9 dosya. Faz 2 `commission_payouts` ise "hakediş"i ödeme yaşam döngüsü olarak kuruyor | **Komisyon** = müşteriden alınan hizmet bedeli (ofis geliri). **Pay** = komisyonun bir danışmana düşen kısmı. **Kazanç** = danışmanın pay toplamı (kişisel sayfa adı). **Hakediş** = payın ÖDEME süreci (hesaplandı → onaylandı → ödendi) yalnız Faz 2 hakediş ekranında. "Cüzdan" adı ve "Kişisel hakediş" eyebrow'u "Kazanç"a çekilir |
| Kayıp-kaçak / kaçan komisyon / kayıp satış / kayıp nedeni | **Üç ayrı sayfa/kavram, "kayıp" ortak**: `app/kayip-kacak` (portal teyit; nav "Kaçan komisyonlar"; sözlükte "Kaçan komisyon"; ana ekran kartı "Kayıp-kaçak"), `app/kayip-satis` (nav VE PageHeader "Kayıp nedenleri"; içeriği ise "Risk altındaki müşteriler ve kaybedilen anlaşmalar", `kayip-satis/page.tsx:208`), ve deal `loss_reason` (kayıp nedeni diyaloğu/raporu). `kayıp-kaçak|kaçan komisyon|kaçak komisyon` 43 satır/24 dosya | **Kaçan komisyonlar** = portal teyidiyle kaçan ilanın tahmini kaybı (para). **Risk altındaki müşteriler** = `kayip-satis` (menü adı ve başlık bu olur). **Kayıp nedeni** = YALNIZ anlaşma kapanışında seçilen sebep (rapor "Kayıp nedenleri" kartı bu). "Kayıp-kaçak kalkanı" yalnız pazarlama başlığıdır |
| Ofis / şube / tenant | `ofis|şube|tenant` /app'te 694 satır/123 dosya (kod tanımlayıcısı ağırlıklı; kullanıcıya görünen "tenant" kullanımı bu turda ayrıca taranmadı: doğrulanamadı) | **Ofis** = müşteri hesabı; **Şube** = ofisin alt birimi; "tenant" kullanıcıya görünmez (sözleşme testiyle taranmalı) |
| Demo / örnek veri | `örnek veri|örnek kayıt|demo veri|demo kayıt` 25 satır/12 dosya (`_home/ust-bolum.tsx`, `_home/sample-seed-button.tsx`, `ayarlar/page.tsx`); /demo, `demo_requests`, demo giriş kartları ayrı kavram | /app'te **Örnek veri** (ofisin içine yüklenen is_sample kayıtlar). **Demo** yalnız satış demosu (/demo, /admin/satis, demo giriş) |
| Yetki | Dört anlam: (1) rol/izin matrisi ("Yetki matrisi", `ayarlar/roller`), (2) satış yetki belgesi (`advisor_profiles.authority_cert_*`), (3) portföy yetki sözleşmesi (`properties.authorization_*`), (4) EİDS yetki belgesi | (1) **İzin / Yetki matrisi**, (2) **Yetki belgesi (danışman)**, (3) **Yetki sözleşmesi (portföy)**, (4) **EİDS kaydı** (ve "kayıtlı bilgi", doğrulama iddiası yok). `ekip/izinler` (tatil) için "İzin takvimi" (MODUL_ENVANTERI §4.1 #10) |
| Eşleştirme | Menü (Talepler sekmesi "Eşleşme"), sayfa "Akıllı eşleşme motoru", eyebrow "Talep × Portföy eşleştirme", Ayarlar "Ağırlıklar" (SADELIK §8) | **Eşleşme** (sekme) ve açıklamada "Müşteriye uygun portföyler" |
| Arama | "Ara…" kutusu, `arama-sonuclari` (genel arama), "Çağrı kaydı"/"Akıllı Arama" (görüşme kaydı) | Genel arama = **Ara**; telefon kayıtları = **Çağrı kaydı** |

**Tek sözlük nerede durmalı:** `src/lib/terminology.ts` (kanonik ad, kullanıcıya görünmeyecek yasak varyantlar, tek cümle tanım). `help-content.ts` içindeki `GLOSSARY` (16 madde: Kaçan komisyon, Ekip Ligi, Aday (lead) skoru, Komisyon payı…) açıklama sözlüğü olarak KALIR ama kanonik adı buradan türetir (bugün "Aday (lead) skoru" sözlük başlığı "lead"i görünür tutuyor). `terminology-contract.test.ts` .tsx dosyalarında yasaklı varyantları (`\blead\b`, "Cüzdan", "Kişisel hakediş" gibi) allowlist dışında yakalar. Maliyet S-M; çağrı noktaları düzeltmesi sayfa sahiplerinin paketine biner.

### 5.2 Mükerrer ekran, eylem, hesap, bileşen

| # | Konu | Kanıt (dosya) | Önerilen TEK yol | Geçiş maliyeti |
|---|---|---|---|---|
| D-1 | Rol etiketleri: `lib/role-labels.ts` var, yine de yerel kopya 8 yerde | `lib/admin/office-create-rules.ts:59`, `actions/platform-export.ts:102`, `app/ekip/[id]/advisor-view.tsx:30`, `ekip/kiyas/page.tsx:28`, `ekip/devir/page.tsx:14`, `admin/members/[id]/page.tsx:24`, `admin/members/page.tsx:18`, `admin/tenants/[id]/office-360-panels.tsx:33` | `lib/role-labels.ts` `ROLE_LABELS`/`roleLabel()` | S |
| D-2 | Ay/gün sınırı | TR-doğru 3 gerçekleme: `app/_home/data.ts:73` (`trMidnight`), `lib/team/scorecard.ts:127` (`trMonthContext`), `lib/team/advisor-metrics.ts` (period). UTC/yerel kopyalar: `app/randevular/page.tsx:185`, `app/kayip-kacak/page.tsx:301`, `app/admin/satis/page.tsx:76`, `app/ekip/izinler/page.tsx:117`. `lib/clock.ts` TR yardımcıları (`trParts`, `trDayStartIso`) var ama AY yardımcısı yok | `clock.ts`'e `trMonthStartIso/trMonthContext` (scorecard'dan taşı); diğerleri bunu çağırır (DENETIM_2 B8) | S + 4 çağrı |
| D-3 | Para biçimi | `lib/format.ts` "tek kaynak" (`formatTry`, `formatMoney`…) ama `tr-TR` biçim çağrısı 284 yerde/171 dosya (bir kısmı meşru tarih biçimi) | `format.ts` + yeni kopyayı yasaklayan sözleşme (allowlist'li) | M (kademeli) |
| D-4 | Komisyon/pay hesabı | `lib/commission.ts` (7 `advisorShare` kullanımı), `lib/team/advisor-share.ts`, `kapanis-sihirbazi.tsx` (3), `commission-simulator.tsx` (5), `portfoyler/[id]/property-workflow.tsx` (4), `actions/workflow.ts` (3), `cuzdan/page.tsx` (2); `advisorShare` 27 geçiş/8 dosya | `commission.ts` hesap çekirdeği; plan girdisi Faz 2 `advisor_commission_plans`'tan (U-03) | M (Faz 2 ile) |
| D-5 | Durum etiketi sözlükleri | 40 `*STATUS_LABEL(S)` sabiti: teklif durumu 3 yerde (`teklifler/[id]/page.tsx:32`, `offer-list-logic.ts:5`, `activity-timeline-sources.ts:9`), sözleşme 2, randevu 2, proje 4 (`status-labels.ts` + 3 sayfa), açık ev 3 | `lib/status-labels.ts` (+ `deal-stage-labels.ts` aşama için) | M |
| D-6 | Boş durum bileşeni | `components/app/empty-state.tsx` (~35 import) sarar `components/ui/empty-state.tsx`; `components/ui/empty-state-v3.tsx` (~14 import) yine `ui/empty-state`i sarar; `ui/empty-state` doğrudan 6 yerde | `ui/empty-state` hedef; `app/empty-state` ve `v3` ince sarmalayıcı → çağrı noktaları taşınınca silinir | M-L |
| D-7 | Sayı kartı | `components/app/stat-card.tsx` (~16 sayfa) ve `components/ui/stat-row.tsx` (~6 sayfa); ayrıca `KpiTile`/`dashboard-grid`. QA_3 YENİ-1: ikisinde de etiket kelime ortasından kırılıyor | Tek `StatRow/KpiTile` ailesi (`DESIGN_SYSTEM.md` kılavuzu), `StatCard` sarmalayıcı | M |
| D-8 | Skeleton | `components/app/skeleton.tsx` (`loading.tsx`'lerde ~24) sarar `ui/skeleton.tsx` (~25 yerde doğrudan) | `ui/skeleton` | S-M |
| D-9 | Sekme/panel sistemleri (7) | `ui/tabs.tsx` (2), `ui/morph-tabs.tsx` (3 doğrudan), `app/page-tabs.tsx` (8 sayfa), `app/detail-tabs.tsx` (9 detay), `app/section-tabs.tsx` (menü kabuğu), `ui/tabbed-form-shell.tsx` (~25 form; `morph-tabs`'e dayanır), `ui/inline-tabbed-panel.tsx` (~10; `morph-tabs`'e dayanır) | Üç net rol: **morph-tabs** (çekirdek), **DetailTabs** (URL'e bağlı detay sekmeleri), **PageTabs** (kabuk sekmeleri); `ui/tabs.tsx` ve `SectionTabs` kullanım azsa morph-tabs'e erit | M |
| D-10 | Tablo | `ui/table.tsx` (~27) ve `ui/data-table.tsx` (~4; yalnız opt-in "premium") | `data-table` hedef; liste kiti (`ui/list-kit`) ile birlikte tek karar: sayfa başına `table` yalnız basit satır, liste sayfaları data-table | M-L |
| D-11 | Diyalog/panel | `ui/dialog.tsx` (onay/önizleme) ve sayfa-içi `InlineTabbedPanel`; 24 ekle/düzenle dosyası hâlâ popup (ISLEM §2.2) | Kural: ekle/düzenle popup olmaz; `Dialog` yalnız onay/önizleme | M (K-paketleri) |
| D-12 | "Yeni müşteri" yolları | 21 giriş noktası: `/app/hizli` (8: `siradaki.ts`, `randevular.tsx`, `musteriler-hizli.tsx`, `aranacaklar.tsx`, sidebar ×2, `quick-create-menu-body.tsx`, `palette-core.ts`) ve `/app/musteriler/yeni` (13: hero, başlayalım, `musteriler/page.tsx` ×3, kurulum sihirbazı, hoş geldin, anlaşma formu, talep formu, palet, yardım…). Ekleme kodu: `customers` insert 6 yerde (`actions/customers.ts`, `lead-intake.ts`, `referrals.ts`, `sample-data.ts`, içe aktarma, RPC) | İki amaçlı iki yüzey KALIR: **Hızlı kayıt** (3 alan, `/app/hizli`) ve **Tam form** (`/yeni`); girişler "Yeni müşteri" menüsü + liste + ana ekran ile sınırlı; insert tek kurucu `lib/customers/create-customer.ts` (telefon/e-posta + mükerrer tek yerde) | M |
| D-13 | Aynı ayar iki yerde | Ayarlar kartları (Y-17 ile temizlendi); kalan: matching ağırlıkları `ayarlar/matching-weights-form.tsx` ve eşleştirme sayfası; atama kuralı `ayarlar/lead` ve (Faz 2) `assignment_rules` ekranı; kurulum yüzdesi `onboarding-checklist.ts` tek kaynak (Y-23) | Faz 2 atama ekranı `ayarlar/lead` altında SEKME olur, yeni sayfa açılmaz | S |
| D-14 | WhatsApp bağlantısı | `lib/phone.ts` (4), `lib/whatsapp-link.ts` (3), `components/app/whatsapp-link.tsx`, `wa-template-menu.tsx`, `ui/list-kit/row-actions.tsx`, `lib/message-templates.ts`, `public/share-feedback.tsx` = 12 `wa.me` satırı/7 dosya | `lib/phone.ts` (`toWhatsAppLink`); `whatsapp-link.ts` silinir | S |
| D-15 | Görev üretimi | `tasks` insert 6 yerde (`actions/tasks.ts` ×2, `customers.ts`, `automation-engine.ts`, `playbook-engine.ts`, `sample-data.ts`) | `lib/tasks/build-task-row.ts` | M |
| D-16 | İki otomasyon motoru | `lib/automation-engine.ts` + cron `otomasyon` ve `lib/playbook-engine.ts` + `playbook-trigger.ts` (olay → görev adımları). Sayfalar menüde "Otomasyon" altında sekme (Y-19) ama motor ve kavram (kural / iş akışı) ayrı | Ortak görev üreticisi (D-15) + sözlükte tek ad "Otomatik işler" (SADELIK §8); motorlar şimdilik ayrı (T-09) | M |
| D-17 | Cron çiftleri | 27 route; benzer işler: `geo-sync` ↔ `geo-province-sync`, `gunluk-ozet` ↔ `haftalik-ozet`, `dunning` ↔ `abonelik-kontrol` ↔ `billing-reconciliation`, `vitrin-alarm` ↔ `vitrin-eslesme`. İşlerin gerçekten çakışıp çakışmadığı bu turda kod okunarak doğrulanmadı | Doğrulanamadı; sahibi olmayan cron eklenmesin: yeni cron (havuz) `check:cron` ile 28'e çıkar | - |
| D-18 | Duyuru/bildirim ailesi | 4 yapı (T-10) | Sayfa birleşimi yapıldı; veri modeli ertelendi | M |
| D-19 | Sayfa örtüşmeleri | `danisman-kpi` + `lig` + `ekip/kiyas` + `hedefler` + `pano-tv` Ekip Merkezi sekmeleri olarak duruyor ve TEK veri kaynağı kullanıyor (Y-07): hesap kopyası bitti, ekran kopyası ad olarak kaldı | Kıyas = karne, Danışman KPI = ciro/sayı, Ekip Ligi = oyunlaştırma: sekme açıklamaları farkı net yazmalı; kullanım verisi (ölçüm) ile tekrar karar | S |
| D-20 | `YOL_HARITASI_V2` "ölü bileşen" listesi | `StatRow` ve `EmptyStateV3` artık kullanılıyor (~6 ve ~14 sayfa) | Listeden çıkar (belge güncellemesi) | S |

### 5.3 Menü ve gezinme

- **Bugünkü menü (`nav-config.ts`):** 9 başlık, 41 öğe: Bugün 3, Müşteriler 5, Portföy 8, Anlaşmalar 3, İletişim 4, Finans 3, Performans 4, Araçlar 3, Ofis 8. `ONERI_LISTESI_KARSILASTIRMA §2.3` hedefi 36 (Modüller paketi uyguluyor, henüz main'de değil).
- **Çelişki ve karar:** ONERI "Anlaşmalar sekmeleri: Anlaşmalar / Kayıp nedenleri" der, ama `kayip-satis` bugün Müşteriler başlığında, modülü `customers` ve içeriği "risk altındaki müşteriler". **Karar:** `kayip-satis` Müşteriler'de kalır (Müşteriler, Akıllı Listeler, Tavsiyeler, Risk altındaki müşteriler tek öğenin sekmesi; Müşteriler başlığı 5 → 2 öğe), Anlaşmalar 3 öğe kalır; toplam yine 41 → 36 (-3 Müşteriler, -2 Portföy). Sekme adı "Kayıp nedenleri" yerine "Risk altındaki müşteriler" (bölüm 5.1).
- **Aynı sayfaya birden çok yol:** `/app/hizli` ve `/app/musteriler/yeni` (D-12); Komisyon öğesi içinde "Kazanç" sekmesi + `/app/ekip/kazanc` alias'ı (tek hedef `cuzdan?sekme=ofis`, iyi); `/app/yatirim`, `/app/arama`, `/app/eslestirme` alias'ları (iyi). "Ana ekran" ayrı bir "Son kullanılanlar" satırında da görünüyordu (SADELIK §2.2): bugünkü sidebar'da tekrar doğrulanmadı.
- **"Daha fazla" içeriği:** sade görünümde çekirdek dışı her şey. Owner/gm/şube müdürü çekirdeği 11 sayfa (`MANAGER_CORE`); yönetim sayfaları (Otomasyon, Uyum, Belge Merkezi, Denetim, Ayarlar) yalnız yönetim rollerinin "Daha fazla"sında. Ayarlar `tier: "more"` olduğu için sahibin sade menüsünde Ayarlar görünmez; "Daha fazla"ya inmek gerekir (sık kullanılan "Roller", "Tanımlar" için fazladan tık). Karar: Ayarlar sahip için çekirdekte kalmalı mı? sahibin kararı #7'ye eklendi.
- **Rol başına menü uzunluğu (sade görünüm, çekirdek):** owner/gm/şube müdürü 11, takım lideri/danışman 12, muhasebe 6, çağrı merkezi 5, salt-okunur 6. Tam görünümde owner 41. Not: `nav-config.ts` `tier: "core"` yalnız "en az bir rol için çekirdek" demektir (Giderler, Aidat, Abonelik, Yardım, Değerleme yalnız belirli rollerde çekirdek); okuyan kişi `tier` ile rol çekirdeğini karıştırabilir: dosya yorumu bunu söylüyor, testle eşitleniyor.
- **Sade görünüm çekirdek listeleri tutarlılığı:** `nav-roles.ts` tek kaynak; `nav-roles.test.ts` ikisini eşitliyor (dosya var, çalıştırılmadı: doğrulanamadı).
- Modüller paketi menüyü ayrıca küçültür (kapalı modül menüde yok); bu belge o davranışı tekrar tasarlamaz.

### 5.4 Kullanıcıyı yanıltabilecek vaatler

| # | Bulgu | Kanıt | Karar |
|---|---|---|---|
| V-1 | Şema bekleyen özellik şema yokken ne gösteriyor? | Faz 2/3 tabloları için `src/` içinde okuma/yazma kodu YOK (yalnız `faz2-migrations-contract.test.ts` ve `customer-with-demand.ts:61` yorumu); yani UI vaadi yok | Sorun yok; kural korunsun: şema uygulanmadan ilgili kod birleştirilmez (FAZ2_MIGRATIONS) |
| V-2 | Şema geride kalan KOD var | `lib/phone.ts` (yabancı/sabit hat) ve `campaign-delivery.ts` | M-01, M-13 (G0) |
| V-3 | "yakında" etiketi | `app/kampanyalar/yeni/new-campaign-form.tsx:121` `E-posta (yakında)` (disabled seçenek); diğer "yakında" eşleşmeleri süre/yaklaşan anlamında (`odeme-link`, `admin/page`) | Seçenek kaldırılır (ISLEM P1-C7 K3'te) |
| V-4 | Kredi faizi varsayılanı | `lib/purchase-costs.ts:136` `DEFAULT_MONTHLY_RATE_PCT = 2.79` ("makul başlangıç" yorumu); kamuya açık `vitrin/[slug]/[id]/purchase-calculator.tsx:39` bunu başlangıç değeri yapıyor; güncelliği doğrulanmadı | "Örnek hesaptır, oranı güncelleyin" etiketi her yüzeyde; sahibin doğrulaması (karar #10) |
| V-5 | TÜFE verisi | `lib/tufe.ts`: tablo ve fallback ("en güncel aya düşer") var; güncellik/doğruluk doğrulanmadı (ORGANIK bölüm 7 #9) | Kira artışı hesaplayıcısı ve ücretsiz araç sahip doğrulayana kadar "yaklaşık" uyarısıyla; `/araclar` yayına AÇILMAZ |
| V-6 | Harç/masraf oranları | `lib/purchase-costs.ts` `DEFAULT_RATES` ("Güncelleme yeri yalnızca DEFAULT_RATES" yorumu); güncellik doğrulanmadı | Aynı etiket + sahibin kontrolü |
| V-7 | Fiyat sayfası ↔ gerçek kapılar | `lib/pricing-page-model.ts` `PLANS` ve `PLAN_GATES`'ten türüyor: şu an tutarlı. Fiyat değeri `plans.ts`, `PRICING.md`, `DECISIONS.md` üçünde yazılı | K2 yeni kataloğu bitince `PRICING.md`/`DECISIONS.md` satırı kaldırılır (tek kaynak `plans.ts`); K2 uyarıldı (AJ-02) |
| V-8 | Sahte/boş KPI | "İmza eksik" randevu KPI'ı hiç dolmaz (ISLEM P1-E8, `randevular/page.tsx:642`); `targets.actual_*` gerçek ofiste hep 0 (ADVISOR §6; gerçekleşme canlı hesaplanıyor, Y-07) | P1-E8 K6'da; `actual_*` sütunları ayrı karar |
| V-9 | "Detayda açıklamayı tamamlarsınız" vaadi, açıklama hiçbir yerde yazılamaz | ISLEM P1-D1 | K4 |
| V-10 | "Elle ekleyin" karşılıksız (komisyon), hakediş ödemesi salt okunur | ISLEM P1-E3 | U-03 |
| V-11 | Rozet/etiket: "Yeni" rozetleri Ayarlar kartlarında kalıcı | `ayarlar/page.tsx` ("Aday yakalama", "Güvenlik", "Duyuru panosu" `badge: "Yeni"`) | Süreli rozet ya da kaldır (S) |
| V-12 | Paket/limit metni ↔ SQL kotası çifte kaynak | ISLEM P1-A4: `plans.ts` ve `plan_entitlements` | K2 tek kaynağa bağlıyor (M-21); izlenmeli |

### 5.5 Belgeler (hangisi güncel, hangisi bayat)

| Belge | Durum | Kanıt | Öneri |
|---|---|---|---|
| `CLAUDE.md` | Büyük ölçüde doğru (27 cron, 9 başlık, koyu tema yalnız /app-/admin) | `src/app/api/cron` 27 route; `nav-config.ts` | Güncelle: "Yeni modül = 4 kayıt yeri" Modüller bitince 5 olur (`src/lib/modules/registry.ts`); `validation/contact.ts` cümlesi (T-14); "27 cron" havuz cron'uyla değişecek; bu belgeye işaretçi ("yol haritası: docs/design/BIRLESIK_YOL_HARITASI.md") |
| `AGENTS.md` | Next.js uyarı bloğu (otomatik üretilir) | Doğru | Dokunma |
| `docs/DURUM.md` | BAYAT sayılar | "Migration dosyası 179" (gerçek 197), "177 dosya vs 176" belirsizliği, tarih 2026-10-03 | Güncelle; sayıları komutla yeniden say (migration, page, test) |
| `docs/MIMARI.md` | BAYAT | "79 migration", "`/api/cron/*` (13)", "~40 modül", tarih 2026-07-26 | Güncelle (27 cron, 197 migration, 9 başlık menü, `ekip` Ekip Merkezi) |
| `docs/ROADMAP.md` | Kısmen bayat | §4 "Çelişkiler" listesindeki iki madde ÇÖZÜLMÜŞ (CLAUDE.md artık "27 cron" ve koyu tema ifadesi düzeltilmiş); §1 "176/177" cümlesi | §4'ü sil; açık işleri bu belgeye işaret ederek tek satıra indir. P0 güvenlik maddeleri (secret, PITR) burada KALIR (sahibin listesi) |
| `docs/YOL_HARITASI_V2.md` | Büyük kısmı tamamlanmış/bayat | "StatRow/EmptyStateV3 ölü (kullanım 0)" artık yanlış; Faz 2 sekmeleri yapıldı | `arsiv/`e taşı; §5 (Tanım yönetimi kararları) bu belgenin U-28/U-32'sine işlenmiştir |
| `docs/OZELLIK_MASTER_LISTESI.md` | Tarihsel (2026-07-26, 97 ekran) | Tarih | `arsiv/`e taşı veya "tarihsel" başlığı |
| `docs/AUDIT_2026-08-13.md`, `FEATURE_QUALITY_MATRIX_2026-08-13.md` | Tarihsel ("production yayını bilinçli olarak bloklu") | Canlı yayında | `arsiv/`e taşı |
| `docs/PRICING.md`, `DECISIONS.md` | K2 yeni kataloğuyla bayatlayacak | `lib/billing/plans.ts` ile bugün tutarlı | K2 bitince güncelle ya da `plans.ts`'e tek işaretçi bırak |
| `docs/design/*` | Belge yığını | Bölüm 8 tablosu | Sınıflandırıldı |
| `docs/design/agent-taslaklari/` | `.claude/agents/`'in kopyası | 5 dosya, aynı adlar | Birini sil |
| `docs/arsiv/` | Doğru yer; 12 eski belge | - | Dokunma |

---

## 6. ÇAKIŞAN / ÇELİŞEN ÖNERİLER: TEK KARAR

| # | Çelişki | Taraflar | Karar ve gerekçe |
|---|---|---|---|
| K-1 | Menü başlığı sayısı | ChatGPT listesi 10 başlık; `ONERI_LISTESI §2.2` 9 başlık | **9 korunur.** Ayrı Pazarlama/Fırsatlar başlığı zaten ait oldukları başlıkta; yeni başlık menüyü uzatır |
| K-2 | Deneme günü tek kaynağı | K1 (`platform_settings.default_trial_days`, M-20) ↔ K2 (`billing.plan_definitions.trialDays`, M-22) | **Öneri: K2 anahtarı (plan kataloğu)**; deneme süresi paket/fiyat kuralıdır, tek katalogda yönetilir. K1 migration'ı atılır ya da K1 ekranı K2 anahtarını düzenler; iki fonksiyon tek kez yeniden yazılır. **Sahibin onayı gerekir** (karar #2). Gerekçe: ikisi uygulanırsa son uygulanan öncekini ezer, deneme günü hangi anahtarın okunacağı belirsizleşir |
| K-3 | Danışman performansı: ayrı ekranlar mı tek kabuk mu | MODUL_ENVANTERI #1 (6 sayfa birleşsin), PERSONA_OFIS #5 (tek kabuk), PERSONA_DANISMAN #7 (Performansım+Cüzdanım) | **Zaten uygulandı:** sahip için Ekip Merkezi sekmeleri, danışman için Performansım; hesap tek kaynakta (`advisor-metrics.ts`). Yeni birleşim yapılmaz; yalnız sekme açıklamaları (D-19) |
| K-4 | Referral/ortak kredisi ↔ K2 kuponu | ORGANIK (ayrı kredi defteri) ↔ K2 (kupon tablosu) | **İkisi ayrı kalır:** kupon fiyatı düşürür (ön indirim, K2 `coupons`); referral/ortak kredisi kazanılmış değerdir (`account_credit_ledger`, ekleme-yalnız). Fatura "indirim satırı" ortak noktadır. Kredi harcama üst sınırı sahibin kararı (ORGANIK #5). AI kredi ölçümü ajanı çıktısı repoda yok: `unit='ai'` için tek defter kararı, o ajan gelince bu şemaya uyar (doğrulanamadı) |
| K-5 | Skor dili | ONERI: "tek /100 danışman skoru, AI lead skoru ELE" ↔ DANISMAN_UZMANLIK: havuz için 0-100 puan | **Açıklanabilir puan serbest, "AI/tahmin" adı yasak:** girdileri ve formülü ekranda, adı "Uygunluk puanı" gibi; havuz puanı toplamı = skor (kabul kriteri). Danışman karnesinde tek /100 skor YOK |
| K-6 | "Yeni müşteri" iki yolu | PERSONA_DANISMAN (hızlı çekmece) ↔ SADELIK (5 giriş çok) | **İki yüzey kalır** (Hızlı kayıt, Tam form), giriş sayısı azalır, insert tek kurucu (D-12) |
| K-7 | Belge/evrak hattı | PIYASA Paket D (evrak linki), ISLEM P0-9/P1-D8 (belge sekmesi, `is_document`), ONERI Ö-5 (tapu fotoğrafı) | **Tek hat:** K4 `is_document` + Belge Merkezi; evrak toplama linki yüklemeyi Belge Merkezi'ne düşürür; tapu ön-doldurma `document-ocr.ts`'i yalnız çağırır (kullanıcı onayıyla); belge görseli hiçbir public yüzeye çıkmaz |
| K-8 | Yetki belgesi bitiş takibi | FEATURE_BACKLOG #4, PERSONA_OFIS #2, ISLEM P0-8, PIYASA §3.0, ONERI Ö-5 | **Tek iş (U-13):** göster (K4) → uyarı → ana ekran sayacı; EİDS "kayıtlı bilgi" |
| K-9 | Lead hızı | FEATURE_BACKLOG #6, PERSONA_OFIS #8, ONERI Ö-3, YOL_V2 Faz 3 | **Tek iş (U-12):** ölçüm + istisna bildirimi; otomatik devir bu işte YOK (atama kuralı U-06 yedek zinciri) |
| K-10 | Kayıp nedeni / aşama etiketi | FEATURE_BACKLOG #1-2, PERSONA_OFIS #6, YOL_V2 §5 | **YAPILDI (Y-15):** dört belge aynı iş; açık madde kalmadı |
| K-11 | Menü bütçesi: Kayıp nedenleri yeri | ONERI (Anlaşmalar sekmesi) ↔ kod (Müşteriler) | Bölüm 5.3: Müşteriler sekmesi, "Risk altındaki müşteriler" |
| K-12 | HIZ_3 ↔ QA_3 CLS | QA_3: mobil `/app` CLS 0,159; HIZ_3: 0,024 | HIZ_3 daha yeni commit'te ölçüldü; QA_3 maddesi kapanmış sayıldı (Y-21) |
| K-13 | Faz 2 "10 dosya" ↔ Faz 3 "5 dosya" ↔ gerçek | FAZ2_MIGRATIONS (10), DANISMAN_UZMANLIK (5 + `FAZ3_MIGRATIONS.md` vaadi) | Gerçek: 10 (Faz 2) + 5 (Faz 3) + 1 (kampanya) + 1 (telefon) + 1 (kayıp nedeni seed) = 18. Bölüm 4 tek kaynak; `FAZ3_MIGRATIONS.md` yazılmadı |
| K-14 | "Yeni modül = 4 kayıt yeri" ↔ Modüller | CLAUDE.md ↔ ONERI Ö-1 | Modüller bitince 5. kayıt yeri `modules/registry.ts`; CLAUDE.md güncellenir |
| K-15 | Perf indeksleri | `14` ↔ `14b` | `14b` ikincisinin yerine geçer, ikisi birlikte uygulanmaz; ertelendi |

---

## 7. SAHİBİN KARARI GEREKENLER (öncelik sırasıyla; kaynak belgelerdeki 60+ kararın TEK listesi)

**En önemli 10 (önce bunlar):**
1. **Migration penceresi:** yedek/PITR doğrulandı mı; G0 (telefon + kampanya) hemen mi; G2 ne zaman; **05 (G3) hangi tarihte ve etki taraması + izole test DB sonrası mı**.
2. **Deneme süresi tek kaynağı** (K-2: plan kataloğu mu platform ayarı mı) ve **yeni fiyat kataloğu** (K2): `PRICING.md`/`DECISIONS.md` güncellenecek.
3. **PII anahtarı** (`ADVISOR_PII_KEY`, sürüm, kaybolursa TC/IBAN geri alınamaz) ya da TC/IBAN hiç saklanmasın (yalnız son 4). KVKK aydınlatma/saklama metni hukukçunun.
4. **Havuz:** varsayılan mod (öneri semi_auto), `min_score` (öneri 70), claim süresi, hangi pakette (öneri Ofis), yeni cron.
5. **Demo:** demo danışmanlar için `auth.users` oluşturma (yeni `createAdminClient` + allowlist) kabulü; "Gerçek kullanıma başla" yetkisi (yalnız owner mı, gm de mi); tekrar demo yükleme.
6. **Ödül/ortak programı:** referral tutarı (1 ay hizmet bedeli mi sabit TL mi), ortak yüzdesi/süresi, yalnız kredi mi nakit ne zaman, bekleme günü (30), çerez ömrü; sözleşme/vergi hukukçu/mali müşavir.
7. **Menü ve Modüller:** 41 → 36 (K-11 kararıyla), Modül ön ayarları, kapatılamaz çekirdek (Uyum, Denetim, Gelen Kutusu?), platform kilidi politikası, Ayarlar sahibin sade menüsünde çekirdek olsun mu.
8. **Yayın öncesi güvenlik (sizin işiniz, ajanlar dokunmaz):** `PLATFORM_MFA_ENFORCEMENT=on`, demo kartlarını kapat (`PRODUCTION_*_OPT_IN`), secret döndürme, Git geçmişi, "kim gördü"/toplu dışa aktarma alarmı gibi ek sert önlemler (onaysız eklenmez).
9. **Dış hesaplar ve hukuk teyidi:** WhatsApp Business hesabı/şablonlar, Emlakfiyati API belgesi + ticari anlaşma (ONERI §3.2), e-imza sağlayıcı ve SMS onayının niteliği, MASAK kapsamı (hukukçu/mali müşavir), KVKK/İYS metinleri, EİDS resmi erişim.
10. **Veri doğrulamaları:** TÜFE tablosu, konut kredisi faiz varsayılanı, harç/masraf oranları (kira artışı aracı ve `/araclar` yayını buna bağlı); eski randevu kayıtlarının UTC düzeltmesi onayı.

**Diğer kararlar (kısa):** havuzda kendi ilanının havuza düşmemesi; belgesi süresi dolmuş danışmanın elenmesi; sitemap'te ofis vitrini opt-in'e geçsin mi, danışman rızası metni; "Powered by" kaldırma hangi pakette; pazar istatistiği n eşiği; malik-müşteri bağı için eski portföylerin geriye dönük doldurulması; benchmark ofis eşiği (≥10) ve "Emlaksoft Endeksi" koşulu; marka/kurum ortaklığı ifadeleri; çapa şehir seçimi; başarı hikâyesi izin formu; mevzuat parametreleri tasarım turu; özel alanlar/özel pipeline aşaması turu; çevrimdışı mod ve sesli komut (V4/ELE); telefon santrali/Gmail/Outlook/portal XML erken görüşme mi.

---

## 8. BELGE YÖNETİMİ (tek yol haritası sonrası)

| Belge grubu | Akıbet |
|---|---|
| **Bu belge** (`BIRLESIK_YOL_HARITASI.md`) | TEK güncel yol haritası + migration planı + terim kararları |
| `docs/ROADMAP.md` | Kısalt: yalnız P0 güvenlik/sahip listesi + bu belgeye işaret |
| `docs/DURUM.md`, `docs/MIMARI.md` | Güncelle (sayıları yeniden say) |
| `docs/YOL_HARITASI_V2.md`, `OZELLIK_MASTER_LISTESI.md`, `AUDIT_2026-08-13.md`, `FEATURE_QUALITY_MATRIX_2026-08-13.md`, `design/FEATURE_BACKLOG.md` | `docs/arsiv/`e taşı (maddeleri bu belgede birleşti) |
| Denetim/QA/Hız kayıtları: `QA_CANLI_RAPOR(_2,_3)`, `HIZ_OLCUM_RAPORU(_2,_3)`, `DENETIM_RAPOR_2`, `DASHBOARD_YERLESIM_DENETIMI`, `ERISILEBILIRLIK_RESPONSIVE`, `CAMPAIGN_DELIVERY_FIX`, `MODUL_ENVANTERI_360`, `ISLEM_TAMLIK_DENETIMI`, `SADELIK_DENETIMI` | Tarihsel kanıt olarak KALIR; açık maddeleri bu belgede; `ISLEM_TAMLIK` K1-K6 paket kapsamı için canlı referanstır |
| Spec'ler: `ADVISOR_AND_MATCHING_SPEC`, `DANISMAN_UZMANLIK_HAVUZ_DEMO_SPEC`, `FAZ2_MIGRATIONS`, `ORGANIK_BUYUME_PLANI`, `ONERI_LISTESI_KARSILASTIRMA`, `PIYASA_VE_FARK_YARATAN_OZELLIKLER`, `PERSONA_*`, `FORMS_SPEC`, `DASHBOARD_SPEC`, `LANDING_SPEC` | Uygulama spesifikasyonu olarak KALIR (tasarım detayı orada); hangi işin ne zaman yapılacağı yalnız bu belgede |
| Ham girdiler: `CHATGPT_ONERI_LISTESI`, `RESEARCH_*`, `ARASTIRMA_*` | `docs/arsiv/` veya `docs/design/girdi/` (karar dışı kaynak); çelişki çıkarsa bu belge kazanır |
| `docs/design/agent-taslaklari/` | Sil (`.claude/agents/` asıl) |

Kural: yeni ajan çıktısı "madde" üretiyorsa bu belgenin tablolarına eklenir (yeni belge açılmaz); migration dosyası eklendiğinde bölüm 4.2'ye satır eklenir.

---

## 9. Doğrulanamayanlar ve sınırlar

- Canlı DB (ledger, CHECK'lerin gerçek hali, cron sağlığı) görülmedi; M-01/M-13 etkisi migration ve kod okumasından çıkarıldı.
- `type-check`, `lint`, `test`, `build`, `db:rls-audit`, `--database` ve `--dry-run` çalıştırılmadı (yalnız statik `validate-migrations`).
- 05 sonrası cüzdan/komisyon sayfalarının rol bazlı gerçek davranışı test edilmedi; yalnız hangi dosyaların `commissions`'ı kullanıcı client'ıyla okuduğu sayıldı.
- Ajan dallarındaki 6 migration yalnız başlık ve ilk satırlarıyla okundu; tam içerik ve numaraları birleşmede değişebilir.
- `lead`, `portföy` vb. sayılar ham metin eşleşmesidir (kod tanımlayıcıları ve yorumlar dahil); kullanıcıya görünen metin ayrımı yalnız belirtilen satırlarda elle doğrulandı.
- "Tenant" kelimesinin kullanıcıya görünen kullanımı, cron çiftlerinin gerçek çakışması (D-17), `ayarlar` içindeki kalan kopya ayarlar, mobil sidebar "Ana ekran" tekrarı bu turda taranmadı.
- K1-K6 ve diğer ajanların güncel çalışma ağaçlarındaki kod değişiklikleri (migration dosyaları dışında) okunmadı.
- Hukuki/mevzuat iddiası yapılmadı; ChatGPT listesinden gelen sayılar ve atıflar doğrulanmamış sayılır.
