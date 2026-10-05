# PANEL KARAR 1 — Uzman Paneli Hakem Kararı

Tarih: 2026-10-05 · HEAD: `b1a16f0` · Hakem: tarafsız moderatör (kod yazmaz, karar yazar).
Girdi: Tur 1 (4 rapor) + Tur 2 çapraz sorgu (4 rapor), `R1_*` / `R2_*` (ofis sahibi, danışman+müşteri, strateji, mühendis).
Durum belgesi: `docs/HAFIZA.md`. Kural: kanıtsız madde "ŞÜPHE" olarak kalır, uydurma yok. Hakem HEAD'e karşı ayrıca doğruladı:
`approval-store.ts` (hasOfficeWideDataScope), `lead-form.tsx:141`, `customer-rows.tsx:84`, `page-gates.ts:47`,
`20260802000300:961`, `supabase/MIGRATION_PAIRS.json` ve `src/lib/cron-auth.ts` YOK, `20260823000100..600` içinde `neighborhood_notes` YOK.

Kısaltmalar: OS = ofis sahibi, DM = danışman/müşteri, ST = strateji, MH = mühendis. R1/R2 = tur. "B/F" numaraları ilgili raporun bulgu numarası.
Ölçütler (hakem): (a) ofis sahibini bunaltır mı, (b) danışmana yük mü, (c) mükerrer mi, (d) KVKK/güvenlik riski var mı, (e) para kazandırır/korur mu.

---

## 1. UZLAŞMA (en az 3 uzman, bağımsız)

| # | Madde | Kanıt (kim, nerede) | Not |
|---|---|---|---|
| U1 | Fiyat/tutar bütünlüğü P0: tek kaynak, `update_tenant_plan_subscription` eski 990/2490/5990/12900 yazıyor, `price_lock_*` yazılmıyor | OS-R1 B10; ST-R1 B5; MH-R1 F1; tur 2'de 4 uzmanın hepsi top-1/2 | Kod yarısı kısmen yapılmış (bkz. §3), SQL yarısı açık. Yıllık tutar SQL'de `*12*0.8` (%20), TS'te "10 öde 12" (%16,7): ikinci tutarsızlık (MH-R2 B4) |
| U2 | Yayın + migration penceresi en kritik iş; ~70 commit / ~40 migration canlıda yok; güvenlik düzelticileri ilgili ana migration'larla AYNI pencerede | OS-R1 B9; MH-R1 F5, F11; ST-R2 D2; DM-R2 top-2; MH-R2 C2 | `MIGRATION_PAIRS.json` yok, `validate-migrations.ts` `proposed/`'e bakmıyor, iki sürüm çakışması duruyor (`20260819020100`, `20260820000100`) |
| U3 | Proposed numara çakışması + zorunlu çift denetimi statik betikle yapılsın (canlı DB'ye yazmaz) | MH-R1 F5, F11; OS-R2 C-F5/F11; ST-R2 F5/F11; DM-R2 MH-F5/F11 | 4/4 |
| U4 | "Vaat = mekanizma": Öncelikli destek / Özel onboarding / SLA ya ölçülen mekanizmaya bağlanır ya listeden çıkar | ST-R1 B12; OS-R1 B10; OS-R2 B12; ST-R2 E1.4; MH-R2 B12; DM-R2 ST-B12 | S iş, geri alınabilir |
| U5 | Ofisin net kalanı (brüt komisyon − hakediş − gider = net) YOK; yeni sayfa DEĞİL, Komisyon sayfasına satır/sekme; yalnız owner/gm; her sayı tıklanır | OS-R1 B3, B11; OS-R2 top-3; ST-R2 OB3; MH-R2 B3; DM-R2 OS-B3 | Kazanç gizliliği RLS (`20260816000500`) ayrı pencere; kod rol kapısı RLS'ten bağımsız şart (MH-R2) |
| U6 | Yetki bitişi verisi var ama gömülü: Karar Bekleyenler'e 5. kutu (`authorization_end`) | OS-R1 B4; MH-R2 B1/B4; ST-R2 OB4; DM-R2 OS-B4 | Sıfır çıkmaz metrik kuralı: portföy listesinde süzgeç yoksa önce süzgeç |
| U7 | Kayıp-kaçak: tek "tahmin" etiketli özet kartı Ofis/denemeye açılsın, detay + otomatik yakalama Profesyonel'de kalsın; danışman bazlı suçlayıcı gösterim yok | ST-R1 B1; OS-R2 ST-B1; MH-R2 ST-B1; DM-R2 ST-B1 | `page-gates.ts:47` hâlâ yalnız Profesyonel (doğrulandı) |
| U8 | Hızlı ilan (`/app/hizli` 4. sekme): değerli, ama TASLAK statü + onay kancası/yayın kapısı/havuz yolu atlanmayacak, komisyon boşsa ofis varsayılanı | DM-R1 B1; OS-R2 A-B1; ST-R2 DM1; MH-R2 B1 | Foto adımı K4 (`is_document`) dalına bağlı |
| U9 | İlan detayında kısa talep formu + amaca uygun KVKK onay metni (mevcut: "tanıtım amacıyla", `lead-form.tsx:141`); metin avukat onaylı | DM-R1 B6; OS-R2 A-B6; ST-R2 DM6; MH-R2 B6 | Honeypot korunur; consent sürümü alanı varsa bump (MH-R2) |
| U10 | Onay kancası dili: hata gibi değil durum ("Yöneticiye iletildi") + onay bildiriminde "Uygula" derin bağlantısı; tek kullanımlık tüketim bozulmaz; varsayılan KAPALI kalır | DM-R1 B4; OS-R2 A-B4; ST-R2 DM4; MH-R2 B4 | `approval-gate.ts:250` metni değişmemiş |
| U11 | Kalıcı çevrimdışı kuyruk YOK; yalnız bellek içi "gönderilemedi, verin korunuyor, tekrar dene" kabul | DM-R1 B3 (kendisi riskli dedi); OS-R2 B3; ST-R2 DM3; MH-R2 B3 | KVKK + paylaşımlı telefon |
| U12 | Ekip Merkezi 7 sekme birleştirmesi şimdilik YOK (kullanım verisi yok, URL/yetki kırılır) | OS-R1 B8 (kendisi "ölçmeden birleştirme" dedi); OS-R2; ST-R2 OB8; MH-R2 B8; DM-R2 OS-B8 | 30. gün karar noktası |
| U13 | Statik SQL/RLS kalıp sözleşme testi (tenant-only `for all/update/delete`, `grant all ... authenticated`, SQL `when 'x' then N` ↔ plan tanımı); gerçek Postgres test altyapısı kurulmaz | MH-R1 F9; OS-R2 F9; ST-R2 F9; DM-R2 MH-F9; MH-R2 C3 | Fiyat sapmasını (U1) yakalardı |
| U14 | Yeni özellik katmanı yayın penceresi tamamlanmadan eklenmez | OS-R1 Y7; ST-R1 Y9; MH-R2 B9; ST-R2 F2; OS-R2 E5 | Tüm uzmanlar |
| U15 | Telefon "Kişi" sekmesine / müşteri listesi "Yeni" önce hızlı forma; "Lead skoru" → "Öncelik puanı" + nedenler | DM-R1 B2, B8; OS-R2; ST-R2 DM2/DM8; MH-R2 B2/B8 | `customer-rows.tsx:84` açık (doğrulandı) |
| U16 | İlk yanıt hızı / yeni talepte danışmana bildirim: ÖNCE mevcut kapsam doğrulanır, yoksa küçük ekleme; bildirim gövdesi PII'siz | DM-R1 B7; OS-R1 B12; MH-R2 B7/B12; ST-R2 DM7 | 4/4 "doğrulanamadı" diyor: SÜPHE (bkz. §2 K6) |
| U17 | Kullanıcıya görünen skor/metrik kaynaklı ve gerekçeli olmalı; sahte skor, "X kişi baktı" yok | DM-R1 Y7; ST-R1 Y8; OS-R1 Y3; MH-R2 B8 | CLAUDE.md kuralı |
| U18 | Eşleştirme sessiz kırpmaları (`MATCH_NOTIFY_DEMAND_LIMIT=500`, `MATCH_CANDIDATE_LIMIT=200`) UI'da görünür + `updated_at desc` sıra | MH-R1 F8; OS-R2 F8; ST-R2 F8; DM-R2 MH-F8 | Toplu `limit()` refactor'ı yapılmaz |

---

## 2. ANLAŞMAZLIK ve HAKEM KARARI

**K1 — Deneme süresi: 14 gün + kullanıma bağlı +7 gün (ST-R1 B3) mı, 30 gün sabit mi?**
- ST: sabit kartsız 30 gün veri girmeyeni de tutar; 14 gün + aktivasyonla uzatma. MH: itiraz, aktivasyon olayı yokken öngörülemez, suistimal. OS: karar verilmiş konu (HAFIZA §7). DM: sahip kararı.
- HAKEM KARARI: **30 gün kalır** (HAFIZA §7, tekrar açılmaz). Kullanıma bağlı uzatma yapılmaz; önce M1 aktivasyon ölçümü 4-6 hafta toplanır, sonra A/B önerisi yeniden açılabilir (MH sırası kabul). KABUL: "deneme bitince hangi sayfalar kilitlenir" önizlemesi (dürüst, ucuz; ST+OS+DM hemfikir). Gerekçe: ofis sahibine ek karar yükü yok, mükerrer karar yok, ölçümsüz kural suistimale açık.

**K2 — Onay muafiyeti: `branch_manager` muaf mı?**
- Kod (HEAD): muafiyet owner/gm/branch_manager (`hasOfficeWideDataScope`), team_lead muaf DEĞİL. HAFIZA §7: "owner/gm ile sınırlanmalı". OS-R2: şube müdürüm güvenilir, kabul. DM-R2: daralt. MH-R2: kodu hizala ya da kararı güncelle; "karar verebilmek" ile "muaf olmak" ayrı kavram.
- HAKEM KARARI: **Sahip kararı gerekir (§7-1).** Öneri: karar belgesine uy, muafiyet owner/gm; branch_manager başkasının işlemini onaylayabilir ama kendi fiyat düşürme/komisyon indirimi onaya düşer. Gerekçe: güvenlik tutarlılığı (kayıtlı karar ile kod aynı olmalı), danışmana yük yok (kural varsayılan KAPALI), ofis sahibine tek soru. Karar gelene kadar kod değişmez; canlıya engel DEĞİL (kural kapalı, MH-R2).

**K3 — Hızlı ilan: canlıya önce mi, sonra mı?**
- OS-R2: top-5, M. ST-R2: 30 gün içinde, kullanım verisine bakarak. MH-R2: yeni özellik, canlıya engel değil; foto K4'e bağlı.
- HAKEM KARARI: **Canlıya almadan ZORUNLU DEĞİL; ilk 30 gün hafta 2-3.** Şartlar: taslak statü, komisyon `commission_rate` NOT NULL/CHECK doğrulanır (boşsa ofis varsayılanı), `enqueueListingPool` yolu atlanmaz, kayıt sonrası foto yönlendirmesi K4 `is_document` migration'ı uygulanana kadar EKLENMEZ. Gerekçe: U14 (yayın önce) + ofis sahibini bunaltmaz + yetki/onay kapısı atlama riski.

**K4 — Ofis net kalanı: canlıya önce mi?**
- OS: en yüksek sahip değeri. MH: yeni özellik, engel değil, ama rol kapısı eksikse push edilmez. DM: görünürlük yalnız owner/gm, danışman payı yalnız kendi satırı.
- HAKEM KARARI: **İlk 30 gün hafta 1-2; kod owner/gm rol kapısıyla çıkar (RLS 000500'e bağlı olmadan).** `earnings_all` tek kaynağı; `is_sample` verisi toplamdan dışlanır ya da "örnek veri dahil" etiketi (HAFIZA §3: toplulaştırmalar is_sample süzmez). Danışman rolü toplamı görmez. Gerekçe: KVKK/çalışan mahremiyeti riski + para bilgisi.

**K5 — Sahibe "yalnız istisna" bildirimi (OS-R1 B12) vs önce danışmana (DM-R2)**
- OS: kaçan müşteri anında sahibe. DM: sahip danışmanı bypass eder, gözetlenmiş hisseder; önce danışman, süre aşılınca sahip. MH: yeni kaynak açmayın, PII'siz link tabanlı; mevcut `ofis-kontrol/kurallar`'a bakın. ST: tek kanal (yeni aday X dk yanıtsız, bekleyen onay).
- HAKEM KARARI: **Kademeli, tek mekanizma.** Önce atanan danışmana; süre aşılırsa sahibe yükseltme; gövde PII'siz, link tabanlı; yeni kural motoru ayarı yazılmaz, mevcut `ofis-kontrol/kurallar` genişletilir; kapalı doğan kuralların "etkin değil" durumu sahibe görünür. Önce kapsam doğrulaması (U16). Gerekçe: danışman yükü + KVKK (bildirim gövdesinde müşteri adı yok) + gürültü.

**K6 — Yeni talep push zinciri var mı? (ŞÜPHE)**
- 4 uzmanın hiçbiri doğrulayamadı. HAKEM: "açık iş" DEĞİL, **doğrulama işi**; sonuç sahte "eksik" yazılmaz (bkz. §4 P6 ilk adım).

**K7 — Kayıp-kaçak: adlandırma (OS-R1 B6) mı paketleme (ST-R2 OB6) mı?**
- ST: sorun adlandırma değil paketleme (Profesyonel kilidi + sade menüde yok). DM: danışmana suçlayıcı görünmesin. MH: etiket/tier sıfır risk.
- HAKEM KARARI: **İkisi birden küçük:** (a) tahmin etiketli ofis-toplam kartı Ofis/denemede (U7), (b) menü etiketi/açıklama ayrımı ("Kaçan komisyonlar" / "Risk altındaki müşteriler"), danışmana görünen metin "fırsat/hatırlatma" tonunda, danışman bazlı liste yok. Kapsam açma (hangi pakete) sahip kararı (§7-4). `askida` rotasına dokunulmaz.

**K8 — Ofis Kontrol'ü öne çıkarma (OS-R1 B7) vs gözetim hissi (DM-R2)**
- HAKEM KARARI: **Yalnız okunmamış uyarı sayısı Karar Bekleyenler'e bağlanır** (OS+ST+MH hemfikir, "etkin değil" doğru gösterilmeli: migration `20260820000100` uygulanmadan boş sayı sahte güven verir). Danışmanın "benim karnem" sayfası kendi verisini şeffaf gösterir; "AI ile izleme" dili ve danışman bazlı yeni skor katmanı YOK. Çalışan izleme için aydınlatma metni sahip/hukuk işi (§7-3).

**K9 — Cron işleri (F7/F10/F12) ve rol kümesi adlandırma (F6)**
- MH-R1: P-orta. ST/OS: 30 gün; OS: F6 itiraz; MH-R2 kendi sırası: 300+ ofis öncesi. 
- HAKEM KARARI: **Canlıya engel DEĞİL; hafta 3-4.** F10 ayrı iş açılmaz, F7 ile birleşir (`forEachActiveTenant`). Önce ucuz kısım (S): `order("id")` + `maxDuration` + işleme sayacı. F12 `verifyCron` düşük öncelik, kopya sayısı ŞÜPHE. F6: yalnız `approvals.ts` `MANAGER_ROLES` yeniden adlandırma + sözleşme testi (S), geniş refactor yok. Gerekçe: şu ofis sayısında risk teorik, ofis sahibine değer üretmez.

**K10 — Aktivasyon (ST-R1 B2, B9): sihirbaz adımı eklemek ofis sahibini bunaltır mı?**
- OS: tek ekran, atlanabilir. DM: mobilde CSV zor, "metinden kayıt"/`/app/hizli` ilk adım. MH: olay tablosu yeni migration, "tablo yok = no-op" deseni.
- HAKEM KARARI: **Önce olay kaydı (ölçüm), sonra sihirbaz değişikliği; sihirbaz adımı çoğaltılmaz, tek ekran, atlanabilir, mobilde hızlı kayıt ilk adım.** Metrikler yalnız ofis-agregat (M1, M5, M6); danışman bazlı çalışma izleme metriği YOK. Olay tablosu `proposed`'a, tenant_id + RLS + PII'siz.

**K11 — Büyüme/referral (ST-R1 B8)**
- MH: tenant-arası ilişki, güvenlik denetimi şart. DM: çerez/aydınlatma, agregat, public portalda "Powered by" sade/kapatılabilir. OS: ilgi dışı, yalnız kredi.
- HAKEM KARARI: **Ay 1 sonu; terfi ÖNCESİ `guvenlik-denetcisi` geçişi şart** (`proposed/20260819000100` sec3 denetiminden geçmedi). Ödül yalnız kredi; müşteri verisi ölçüme sızmaz; çerez bildirimi hukuk onayı; TÜFE aracı yayına açılmaz.

**K12 — İptalde neden + duraklat (ST-R1 B11)**
- HAKEM KARARI: **Önce tek soruluk "iptal nedeni" (kod + küçük tablo), duraklatma/oransal 30. gün sonrası.** Oransal taslak `pg_get_functiondef + replace` ile gövde yamar: bu desen fiyat düzeltmesinde kullanılmaz (MH-R2 Y2). Duraklatmada portal tokenları çalışmaya devam eder (DM-R2).

**K13 — F9 kapsamı canlıya önce mi?**
- ST: yalnız SQL-TS plan sabit testi canlıya önce, gerisi 30 gün. MH: S, hepsi ucuz.
- HAKEM KARARI: **Plan sabit testi P1 paketine dahil (zorunlu); genel kalıp testi hafta 1.**

**K14 — Mobil sabit eylem şeridi (DM-R1 B5)**
- Hepsi "önce doğrula" dedi. HAKEM: doğrulanana kadar açık iş DEĞİL, **ŞÜPHE**; canlı QA sonrası mobil elle bakılır, varsa mükerrer yazılmaz.

---

## 3. ZATEN ÇÖZÜLDÜ (HEAD `b1a16f0`'a karşı; sahte "açık iş" bırakılmaz)

| Madde | Durum | Kanıt |
|---|---|---|
| Karar Bekleyenler ana ekranı, sade menü (11 çekirdek), Brifing birleşimi | ÇÖZÜLDÜ, dokunma | OS-R1 B1/B2; `_home/karar-bekleyenler.tsx`, `nav-roles.ts` |
| Danışman çıkış devri (5 kapsam) | ÇÖZÜLDÜ; "çıkış sihirbazı" yazılmaz | `team/handoff.ts`, `ekip/devir` |
| Komisyon ekranı sıfır çıkmaz metrik | ÇÖZÜLDÜ | `komisyon/page.tsx` |
| `/app/hizli` (müşteri/görüşme/randevu), danışmana göre ana ekran, randevu "Başka zaman öner", malik portalı `PortalContactBar`, manifest ikonları | ÇÖZÜLDÜ | DM-R1 başlık notu |
| Onay muafiyeti: team_lead muaf DEĞİL; fail-open kapalı (tablo yok dışında hata fırlatır; gate `error` döner) | ÇÖZÜLDÜ (MH-R1 F2'nin ilk yarısı); kalan: branch_manager kararı (K2) ve `properties` UPDATE RLS ile doğrudan PostgREST fiyat düşürme ŞÜPHE (doğrulanmadı) | `approval-store.ts:4,42` (hasOfficeWideDataScope); `store.ts` |
| `kvkk_requests` rol kapısı + trigger | KODDA ÇÖZÜLDÜ, **UYGULANMADI** | `20260823000300_sec3_kvkk_requests_role_guard.sql` |
| Anket modülü RLS (`for all` yok, `survey_is_manager`, `grant select,insert,update`) | ÇÖZÜLDÜ (taslakta); terfide numara + son kontrol | `proposed/20260820010000_survey_module.sql` |
| `approval_requests`, listing_pool, property_owner_info, advisor_private, coupon düzelticileri | KODDA YAZILDI, UYGULANMADI | `20260823000100..000600` |
| F1 TS yarısı: `resolveCatalogSettings(null)` onaylı katalog (749/4990, Business gizli) | KISMEN ÇÖZÜLDÜ: `plans.ts` ham varsayılanı hâlâ 990/2490/5990/12900 ama okuyucu override ile ezer; `plans.ts`'e doğrudan bakan kod eski fiyatı görür | MH-R2 tablo; `plan-default-catalog.test.ts` |
| DENETIM_RAPOR_2 yanlış pozitifleri (UTC ay, fail-open rol, nav-badges "estimated", danisman-kpi limit) | KAPANDI | MH-R1 giriş |
| F6 kısmen: `assignable-roles.ts` açıklamalı kümeler | KISMEN; `approvals.ts:114` aynı ad | MH-R2 |
| "Lead hızı" → "Aday hızı" terimi | ÇÖZÜLDÜ (ST-R2 beyanı; "Lead skoru" ise AÇIK) | ST-R2 DM7 |

Hâlâ AÇIK (doğrulandı): SQL tutar ezmesi (`20260802000300:961`, `fulfill_billing_payment` 20260731000138:337, `provision_registration` 20260731000140:132, demo 20260802000400:112); yıllık `*12*0.8`; proposed çakışmaları; `MIGRATION_PAIRS.json` ve `cron-auth.ts` yok; `maxDuration` yalnız 3 cron; `neighborhood_notes` update/delete tenant-only (`20260821000100:37-46`, sec3'te yok, dosya uygulanmadığı için yerinde düzeltilebilir); "tanıtım amacıyla" onay metni; "Lead skoru"; onay mesajı "tekrar yapabilirsiniz".

---

## 4. CANLIYA ALMADAN ZORUNLU İŞ PAKETLERİ

Canlıya alma iki kapıdır: (P) `git push` → Vercel deploy (kod), (M) sahibin migration penceresi (DB). Push DB'yi değiştirmez (MH-R2). Aşağıdakilerden P1-P5 hem push hem migration öncesi tamamlanır; P6/P7 push'u engellemez ama "bu hafta" önerilir.

**P1 — Fiyat bütünlüğü (KOD)** · S-M
- Kapsam: `plans.ts` ham varsayılanlarını onaylı katalogla hizala (`plan-default-catalog.test.ts` güncelle); `PRICING.md` güncel katalogla değiştir ("%20 yıllık" ifadesi kaldır, "10 öde 12 = 2 ay hediye"); SQL<->TS plan sabit sözleşme testi (`when 'x' then N` == plan tanımı). Mekanizması olmayan vaatler (U4) listeden çıkarılır veya mekanizmaya bağlanır.
- Dosya sahipliği: `src/lib/billing/plans.ts`, `plan-default-catalog.test.ts`, yeni sözleşme testi, `docs/PRICING.md`, `src/lib/billing/plans.ts` vaat metinleri / admin özellik listesi. Başka ajan bu dosyalara dokunmaz (koltuk fiyatlama ajanı `seat-pricing.ts` ayrı, çakışma kontrolü şart).
- Bağımlılık: yok (kod); fiyat kararı HAFIZA §7'de zaten onaylı.
- Kabul: `npm run test` yeşil; testte SQL sabitleri plan tanımıyla karşılaştırılıyor (şu an KIRMIZI olması beklenir, P2 ile yeşile döner veya bilinen-açık listesi gerekçeli); `PRICING.md` ile kodda aynı 749/2.490/4.990/8.990; admin vaat listesinde mekanizmasız vaat yok.

**P2 — Fiyat bütünlüğü (SQL migration)** · M
- Kapsam: tek yeni forward-only migration; `update_tenant_plan_subscription`, `fulfill_billing_payment`, `provision_registration`, demo dönüşümü AÇIK GÖVDELİ `CREATE OR REPLACE` ile yeniden tanımlanır (`pg_get_functiondef + replace` KULLANILMAZ); tutar çağırandan `p_amount_try` veya mevcut abonelikten; `price_lock_*` yazılır; yıllık hesap TS ile aynı ("10 öde 12"); yenileme tutarının `amount_try`'den okunduğu doğrulanır (MH-R2 ŞÜPHE). `proposed/20260820000100` D bölümü (Business) bununla birleşik düşünülür, numarası değişir.
- Dosya sahipliği: yeni `supabase/migrations/2026...`, rollback, ilgili test. `migration-yazici` ajanı yazar, canlıya UYGULAMAZ.
- Bağımlılık: sahip migration penceresi (§7); fiyat kararı mevcut.
- Kabul: `check:migrations`, `db:migrate -- --dry-run` temiz; P1 sözleşme testi yeşil; plan değişimi + Founders yeni fiyatla ve kilitle çalışıyor (izole test DB'de). Bu migration uygulanmadan Founders/yeni fiyat/plan değişimi (admin) KAPALI.

**P3 — Migration/yayın penceresi koruması (KOD, betik)** · S-M
- Kapsam: `scripts/validate-migrations.ts` kapsamına `supabase/proposed`: sürüm çakışması, 14 hane, `migrations/` içindeki en büyük sürümden küçük olmama; `supabase/MIGRATION_PAIRS.json` (sec3 `20260823000100..600` ile ilgili ana dosya çiftleri; yalnız bir yarısı uygulanabilirse `check:migrations` hata); yamalayıcı migration'a gövde parmak izi (md5 `pg_get_functiondef`) veya yamalayıcı desenden vazgeçme (P2 ile). Proposed çakışmaları çözülür (terfide yeni numara).
- Dosya sahipliği: `scripts/validate-migrations.ts`, yeni `supabase/MIGRATION_PAIRS.json`, test. `supabase/proposed/*` yeniden numaralama işi ayrı, tek ajan.
- Bağımlılık: yok. Terfiden ÖNCE.
- Kabul: kasıtlı çakışan örnek dosyayla betik hata veriyor; mevcut çakışmalar (`20260819020100`, `20260820000100`) raporlanıyor/çözülüyor; `check:migrations -- --database` yeşil.

**P4 — Güvenli yayın penceresi runbook'u (SAHİP İŞİ + belge)** · M
- Kapsam: sıra: yedek/PITR doğrula → `check:migrations -- --database` → `db:migrate -- --dry-run` → `db:migrate` → `db:rls-audit` → canlı QA (`canli-qa` ajanı). Kazanç gizliliği RLS (`20260816000500`) AYRI pencere ve rol smoke'u ile. K4 `is_document` migration'ı K4 dalı `main`'e girmeden ÖNCE. Sec3 düzelticileri ilgili ana dosyalarla aynı batch'te; `neighborhood_notes` (P5).
- Dosya sahipliği: `docs/DEPLOY.md` / `docs/runbooks/` (runbook ajanı), uygulayıcı: SAHİP.
- Bağımlılık: P2, P3 bitmiş; yedek/PITR; MFA bayrağı, demo kartları, anahtar rotasyonu (HAFIZA §8 sahip listesi).
- Kabul: `db:rls-audit` temiz, `canli-qa` public smoke yeşil, ledger drift yok.

**P5 — Kalan RLS işleri + statik SQL kalıp testi** · S
- Kapsam: `neighborhood_notes` update/delete politikası (created_by veya yönetici; dosya uygulanmadığı için yerinde ya da yeni sec3 dosyası; uygulanmışsa forward-only); `properties` UPDATE RLS'in doğrudan PostgREST ile fiyat düşürmeye izin verip vermediği DOĞRULANIR (ŞÜPHE→kanıt); statik SQL kalıp testi (U13). Anket terfi öncesi numara + RLS gözden geçirme.
- Dosya sahipliği: yeni sözleşme testi, ilgili migration dosyası, denetim notu.
- Bağımlılık: yok (P3 ile paralel).
- Kabul: kalıp testi sıfır istisnasız veya gerekçeli listeyle yeşil; `properties` UPDATE sonucu `docs/design`'a tek paragraf notla kaydedilmiş.

**P6 — KVKK talep formu metni + doğrulama ön işleri** · S (kod) + hukuki onay
- Kapsam: `lead-form.tsx` onay metni amaca uygun (talebe dönüş + iletişim; tanıtım ayrı kutu); kısa mod ilk 30 güne (K-§5). Aynı pakette doğrulamalar: yeni talep → danışman bildirim zinciri var mı (K6), `lead-intake` iletişim kanalsız talep kabul ediyor mu (DM-R1 B6 ŞÜPHE).
- Dosya sahipliği: `src/app/lead/[token]/lead-form.tsx`, consent metin sabiti, doğrulama notu.
- Bağımlılık: AVUKAT/SAHİP metin onayı (§7-3). Kod metni onay gelmeden değiştirilmez; mevcut metin zaten canlıda "tanıtım" diyor, push durumu kötüleştirmez (MH-R2), bu yüzden P6 push engeli DEĞİL ama "bu hafta" önerilir.
- Kabul: onaylı metin sürüm bump'ıyla yayında; honeypot çalışıyor; doğrulama sonucu yazılı (var/yok).

**P7 — Küçük terim/metin temizliği** · S
- Kapsam: "Lead skoru" → "Öncelik puanı" + tıklayınca nedenler (`customer-rows.tsx:84`, `musteriler/page.tsx:777`, `terminology.ts` testi); onay mesajı durum dili + "Uygula" bağlantısı (`approval-gate.ts:250`, `actions/approvals.ts`); telefon "Kişi" sekmesi + müşteri listesi "Yeni" önce hızlı (`customer-tabs.ts`, `form-tabs-contract.test.ts`).
- Dosya sahipliği: yukarıdaki dosyalar; tek PR.
- Bağımlılık: yok. Kabul: sözlük/sekme sözleşme testleri yeşil; PhoneInput/`parsePhoneStrict` kontratı bozulmamış; tek kullanımlık tüketim testi yeşil.

Not: P6 ve P7 push'u bloke etmez; P1, P3 bloke eder (kod bütünlüğü); P2, P4, P5 migration kapısını bloke eder. K4 kodunun main'e girişi `is_document` migration'ına bağlıdır.

---

## 5. CANLIYA ALDIKTAN SONRA İLK 30 GÜN

**Hafta 1**
- Aktivasyon olayı (`proposed` olay tablosu, "tablo yok = no-op" deseni) + admin görünümü; M1 (7 günde ≥10 müşteri + ≥3 portföy + ≥1 eşleşme) agregat. Migration terfisi sahip penceresiyle.
- Karar Bekleyenler'e "yetkisi bitecek portföy" 5. kutusu (+ portföy süzgeci yoksa süzgeç); Ofis Kontrol okunmamış uyarı sayısı.
- Genel SQL/RLS kalıp testi (kalan), `neighborhood_notes` kapanışı.
- Canlı QA bulguları (mobil form çubuğu, menü yoğunluğu, sihirbaz, TV/tur) → kritik olanlar düzeltilir.

**Hafta 2**
- Ofis net kalanı (Komisyon sayfası, owner/gm, `is_sample` dışlama) + kayıp-kaçak tahmin özet kartı (paket kararına göre).
- Aday hızı bildirimi: kapsam doğrulaması sonucuna göre atanan danışmana push + "yanıt bekleyen" satırı (aranacaklar), süre aşılınca sahibe yükseltme.
- Onay/telefon/terim temizliği canlıda kullanıcı geri bildirimiyle gözden geçirme (P7 ile yapıldıysa atlanır).

**Hafta 3**
- Vitrin talep kısa modu (ilan başlığı önceden dolu; onaylı KVKK metniyle).
- Hızlı ilan 4. sekme (taslak, komisyon varsayılan, havuz/onay yolu korunur; foto yönlendirmesi K4 migration'ı uygulanmışsa).
- Eşleştirme "N kayıttan ilk M tarandı" notu + `updated_at desc`.

**Hafta 4**
- Cron: `order("id")` + `maxDuration` + işleme sayacı (+ F10 birleşik `forEachActiveTenant`, `verifyCron` düşük öncelik), `approvals.MANAGER_ROLES` yeniden adlandırma.
- Referral: `guvenlik-denetcisi` geçişi sonrası terfi; ödül kredi; "Powered by" sade.
- M5/M6 (ofis sağlık, kural tabanlı, formülü açık).
- Koltuk uyarı kartı (%80, yalnız sahibe, okuma-yalnız) yalnız `seat-pricing.ts` ve P2 yayında ise.

**30. gün karar noktası:** Ekip Merkezi sekme birleşimi (kullanım verisiyle), kullanıma bağlı deneme uzatma A/B (M1 verisiyle), duraklatma/oransal (P2 sonrası), AI kredi ek paketi (2-3 ay veri), koltuk fiyatlama genel açılış.

---

## 6. ASLA YAPILMAYACAKLAR (birleşik)

1. Yeni "Sahip Paneli / Finans Merkezi / Performans-Skor" sayfası veya menüye yeni başlık/çekirdek öğe: mevcut ekrana satır/kutu/sekme eklenir (36 öğe sözleşmesi; mükerrer ekran). (OS-Y1/4/5, DM-Y4/6)
2. Fiyat bütünlüğü (P1+P2) bitmeden canlıda yeni fiyat, Founders, Business, plan değişimi, duraklatma/oransal açmak; ömür boyu Founders veya ücretsiz paket. (ST-Y5/9, MH-Y6, MH-R2 Y4)
3. Onay kurallarını varsayılan AÇIK göndermek, her işleme zorunlu gerekçe/imza koymak, onay yetkisini/muafiyeti team_lead'e açmak, onaylanan işlemi "otomatik uygula" yapmak (tek kullanımlık tüketim ve denetim izi bozulur). (DM-Y2/3, MH-R2 D5)
4. Kişisel veriyi cihazda kalıcı tutmak (IndexedDB kuyruğu), `/app` sayfalarını service worker'da önbelleğe almak: KVKK + paylaşımlı telefon. (DM-Y5, MH-R2 B3)
5. Sahte/gerekçesiz skor, kaynağı olmayan müşteri metriği ("X kişi baktı", sahte kıtlık), doğrulanmamış hukuki sabit (kira tavanı, harç, MASAK), kanıtsız "ilk/tek" iddiası, avukat onaysız "KVKK uyumlu"/"veri ofiste kalır" iddiası. (ST-Y3/7/8, DM-R2 ST-B7)
6. Danışman bazlı gözetim/skor/"AI danışman puanı"/gizli aktivite izleme, danışmana "kaçıran" diyen suçlayıcı ekran; ofis-agregat dışı çalışma izleme metriği. (OS-Y3/8, DM-R2 E3, ST-R2)
7. Canlıya çıkmamış ~70 commit / ~40 migration varken yeni özellik katmanı eklemek; migration'ları tek dev pakette birleştirmek; güvenlik düzeltici migration'ı ana dosyadan ayrı uygulamak; uygulanmış migration'ı değiştirmek; `proposed` dosyasını numara değiştirmeden `migrations`'a kopyalamak. (OS-Y7, MH-Y1/8, ST-F2/3)
8. Fiyat düzeltmesinde `pg_get_functiondef + replace` yamasını kullanmak (araya girmiş fonksiyon değişikliklerini ezer); açık gövdeli `CREATE OR REPLACE` kullanılır. (MH-R2 D2)
9. Kazanç gizliliği RLS'i (`20260816000500`) rol smoke'u ve dry-run olmadan, sec3 ile toplu uygulamak; kazanç toplamı gösteren ekranı owner/gm kod kapısı olmadan push etmek. (OS-Y10, MH-R2 D3)
10. Portal/Chrome eklentisi veya sözleşmesiz sahibinden/Hepsiemlak veri çekme, rakip ilan scrape; resmî entegrasyon vaadi (EİDS, e-fatura, portal yayını) kod çalışmadan. (OS-Y6/8, ST-Y1)
11. Gerçek Postgres tabanlı test altyapısı (docker/pglite/pgTAP); rol/izin sistemini yeniden yazmak; 69 `limit()` kalıbını toplu refactor etmek; cron'ları kuyruk sistemine taşımak (ölçüm göstermeden). (MH-Y1/2/4/5)
12. Malik ve müşteri portal token modellerini aceleyle tek "süper portal"da birleştirmek; hızlı kayıt formlarına alan eklemek; çok adımlı müşteri formu / zorunlu e-posta-bütçe; KVKK onayını tek kutuda çok amaçla birleştirmek. (DM-Y1/8/9)
13. Çok kademeli kullanım bazlı fiyat matrisi, nakit ortak/affiliate komisyonu, "EmlakSoft Endeksi"/"Verified Office" rozeti; yeni vitrinlik özellik yatırımı (sunucu ses, 360°, AI staging, açık uçlu WhatsApp botu). (ST-Y2/3/4/6)
14. Sert güvenlik (zorunlu 2FA/TOTP) onaysız eklemek; geliştirme bitene kadar kapalı (hafıza kararı).
15. Kullanım verisi yokken Ekip Merkezi sekmelerini birleştirmek veya dashboard sürükle-bırak/özelleştirme motoru yazmak. (OS-Y9, OS-B8)

---

## 7. SAHİP KARARI GEREKENLER (seçenekler + hakem önerisi)

| # | Karar | Seçenekler | Hakem önerisi |
|---|---|---|---|
| S1 | Fiyat/DB tutarı: onaylı katalog (749/2.490/4.990/8.990/özel) zaten HAFIZA §7'de onaylı. Karar: (a) DB fonksiyonlarının tutarı çağırandan alması (b) yıllık "10 öde 12" (%16,7) ile SQL `*0.8` hizalaması (c) mevcut abonelerin tutarı | Katalog tutarına otomatik geç / mevcut aboneliğin tutarını koru | (a) çağırandan/abonelikten al; (b) TS'e uy ("10 öde 12", "%20" ifadesi kaldır); (c) mevcut abonelik tutarı korunur (sürpriz fatura yok). Founders yalnız P2 sonrası |
| S2 | `branch_manager` onay muafiyeti | owner/gm (HAFIZA) / owner/gm/branch_manager (kod) | owner/gm ile hizala; şube müdürü onaylayabilir, kendi işleminde muaf değil (K2) |
| S3 | KVKK/hukuki metin onayı: lead formu amaç metni; aydınlatma (çalışan izleme/Ofis Kontrol); attribution çerezi; "veri ofiste kalır" satış dili | Avukat metni / mevcut metin | Avukata gönder; onaysız yayınlama; lead formu metni bu hafta |
| S4 | Kayıp-kaçak motorunun Ofis paketine açılması | (a) yalnız tahmin özet kartı Ofis + denemede, detay Profesyonel'de (b) tamamı Ofis'e (c) hiç | (a): ürün değerini gösterir, Profesyonel'e geçiş gerekçesini bozmaz; "tahmin" etiketi, danışman görmez |
| S5 | Deneme süresi | 30 gün sabit (mevcut karar) / 14 + aktivasyonla +7 | 30 gün kalsın; M1 4-6 hafta ölçülsün, sonra yeniden bak (K1) |
| S6 | Migration penceresi zamanı + yedek/PITR + `git push` | Hemen / P1-P5 sonrası | P1 (kod) ve P3 sonrası push; P2/P4 sonrası migration; kazanç gizliliği RLS ayrı gün. Push'u sahip kendisi yapar (HAFIZA §1) |
| S7 | Kazanç gizliliği RLS `20260816000500` uygulama zamanı | Birlikte / ayrı pencere | Ayrı pencere, rol smoke'u ile (net kalan ekranı kodda zaten owner/gm kapılı) |
| S8 | Founders: N, süre, indirim oranı | Süreli (12 ay) / ömür boyu | Süreli, gerçek sayaç, ömür boyu yok; oran ve N sahibin; P2 sonrası |
| S9 | Koltuk fiyatı ve ek kullanıcı tek fiyat/paket (399, 349) | Kademeli / tek fiyat | Tek fiyat/paket (HAFIZA §7 ile uyumlu); `seat-pricing.ts` çıktısı P2 sonrası |
| S10 | Referral ödül oranı/vergi | Kredi / nakit | Yalnız kredi; vergi mali müşavir teyidi |
| S11 | Çapa şehir (organik büyüme, ORGANIK §5) | Yazılı karar / yok | Yazılı çapa şehir; ≥15 aktif ofis olmadan dizin/ağ vaadi yok |
| S12 | Destek SLA/öncelikli destek: mekanizmaya bağla (öncelik alanı + `ticket-sla` hedefi) mi listeden çıkar mı | Bağla / çıkar | Çıkar (S iş), mekanizma kurulunca geri ekle; sayı sahibin |
| S13 | Sahibe bildirim eşiği (X dk yanıtsız) | 15 / 30 / 60 dk | 30 dk (danışmana 10 dk sonra), sessiz saat; sahibin ayarı |

---

## 8. Panel süreci nasıl tekrarlanır (10 satır)

1. Hakem önce `docs/HAFIZA.md` ve güncel HEAD'i okur; panel tek hafıza belgesine bağlanır.
2. Tur 1: dört rol (ofis sahibi, danışman+müşteri, strateji, mühendis) bağımsız, salt-okunur rapor yazar; her bulguda KANIT, DEĞER/MALİYET/RİSK, "sistemde var mı", ayrıca YAPILMAMASI GEREKENLER.
3. Tur 2: her uzman diğer üç raporu çapraz sorgular (DESTEK / İTİRAZ / DEĞİŞTİR / ZATEN ÇÖZÜLDÜ) ve kendi bulgularını GÜNCEL HEAD'e karşı yeniden doğrular.
4. Her uzman kendi top-7 listesini ve "canlıya önce / ilk 30 gün / asla" kısımlarını yazar.
5. Tur 3: hakem tüm raporları tam okur, ≥3 uzmanın bağımsız söylediklerini UZLAŞMA, itirazlıları ANLAŞMAZLIK yapar.
6. Hakem uzlaşmazlıklarda ölçüt uygular: ofis sahibine bunaltıcı mı, danışmana yük mü, mükerrer mi, KVKK/güvenlik riski mi, para kazandırır mı.
7. Hakem kritik iddiaları grep ile HEAD'e karşı doğrular; çözülenleri "ZATEN ÇÖZÜLDÜ"ye taşır, doğrulanamayanı "ŞÜPHE" bırakır.
8. Çıktı tek karar kaydıdır (`docs/design/PANEL_KARAR_N.md`); `docs/HAFIZA.md` "Bekleyen / engelli işler" bölümüne tek satır işaret eklenir.
9. İş paketlerine dosya sahipliği, S/M/L, bağımlılık ve kabul ölçütü yazılır; ajanlar `isolation:"worktree"` ile çakışmasız çalışır, push yok.
10. Tetik: büyük yayın öncesi veya ~70 commit/yeni modül sonrası; her tur raporları scratchpad'de, yalnız karar kaydı repoda kalır.
