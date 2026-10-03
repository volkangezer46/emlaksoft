# Persona: Emlak Ofisi Sahibi — "Bu uygulamadan ne ister?"

Tarih: 2026-10-03 · Rol: kıdemli ofis sahibi + yönetici danışmanı + ürün yöneticisi bakışı · Kod değiştirilmedi.
Yöntem: önce envanter (docs/MIMARI.md, DURUM.md, design/FEATURE_BACKLOG.md, DASHBOARD_SPEC.md, `src/lib/nav-config.ts`, `src/lib/permissions.ts`, `src/app/app/**`, `supabase/migrations`), sonra ihtiyaç eşlemesi.
Kural: uydurma istatistik yok. Dış kaynak yalnız FEATURE_BACKLOG.md'de zaten açılmış sayfalardan alıntılanır; bu turda yeni web taraması yapılmadı. Doğrulanamayan iddialar **[DOĞRULANAMADI]** ile işaretlidir. Durum etiketleri: VAR / KISMEN / YOK / MÜKERRER.

## 0. Envanter özeti (neye dayanıyoruz)

- Menü: `NAV_SECTIONS` = 9 başlık, 40 menü öğesi (sekmelerle ~50 sayfa girişi). Başlıklar: `bugun`(4), `musteriler`(5), `portfoy`(8), `anlasmalar`(3), `iletisim`(5), `finans`(3), `performans`(6), `araclar`(3), `ofis`(9). `src/app/app/` altında 60+ klasör; `page.tsx` toplamı 160 (DURUM.md).
- Roller: `owner, gm, branch_manager, team_lead, advisor, call_center, accounting, readonly` (`permissions.ts`); 28 modül. Menü yalnız `module` yetkisine göre süzülür, **role göre sade mod yok** (nav-config'te rol kavramı yok).
- Ana ekran (`src/app/app/page.tsx`) 24 ayrı `_home/*` bloğu akıtır: hero, duyuru, kurulum şeridi, BugunOzet, KomisyonAkisi, KpiSatiri, DonemTrend, HedefKarti, Randevular, Gorevler, KayipKacak, PortfoySeridi, KiralamaProje, Huni, CanliAkis, PortalSagligi, Ekip, KaynakDagilimi, HizliAksiyonlar…
- Mevcut kod-belge farkları (FEATURE_BACKLOG §b): portal adaptörleri iskelet, e-fatura iskelet, EİDS/İYS/BTRANS resmi entegrasyon yok, özel alan altyapısı yok.

## 1. Sahibin zaman akışı

| Ritim | Sahibin sorusu | Bakacağı yer (bugün) |
|---|---|---|
| Sabah (5 dk) | "Dün ne oldu, bugün ne yanıyor, kim ne yapacak?" | `/app` + `/app/brifing` (+ 07:00 `gunluk-ozet` cron) |
| Gün içi | "Takılan iş, bekleyen onay, kaçan müşteri var mı?" | `/app/onaylar`, `/app/kayip-kacak`, `/app/gelen-kutusu` |
| Hafta | "Ekip çalışıyor mu, huni tıkandı mı, portföy taze mi?" | `/app/danisman-kpi`, `/app/raporlar`, `/app/portfoyler` |
| Ay | "Ciro, komisyon dağıtımı, gider, net kalan?" | `/app/komisyon`, `/app/giderler`, `/app/ekip/kazanc`, `/app/hedefler` |
| Yıl/stratejik | "Bölge, rakip, kadro, vergi/evrak düzeni, ofis değeri?" | `/app/bolge-analizi`, `/app/uyum`, `/app/ekip` |

## 2. Sahibin ana ihtiyaçları (10 çekirdek + 2 ek)

Her başlık: iş hikâyesi, beklenen çıktı, EmlakSoft karşılığı.

### İ1. "Sabah 5 dakikada ofisin nabzını tut"
- **Hikâye:** Sahip kahvesini alırken telefonda tek ekran görmek ister: dün kaç randevu/teklif/anlaşma, bugün kim nerede, hangi iş gecikti, kasaya ne girecek.
- **Çıktı:** 5-7 kalemlik "bugün ne yapmalıyım" listesi (karar gerektirenler üstte), tek dokunuşla ilgili kayda gidiş.
- **Karşılık: KISMEN + MÜKERRER.** Veri var ama dağınık: `/app` (24 blok), `/app/brifing` (`brifing/page.tsx`), `gunluk-ozet` cron, `pano-tv`, `bugun-ozet.tsx`/`gorevler.tsx`/`randevular.tsx` aynı "bugün" kuyruğunu üç yerde farklı sunuyor. Eksik: sahibe özel "karar bekleyenler" kuyruğu (onay + istisna + eşikleri aşan olaylar) ve rol-bazlı ana ekran. DASHBOARD_SPEC.md zaten "3 KPI katmanı, hiyerarşisiz" teşhisini koymuş.

### İ2. "Ekibimi izleyeyim ama gözetlemeyeyim"
- **Hikâye:** Kim aktif, kim sessiz, kimin müşterisi ilgisiz kalıyor, kimde yük fazla.
- **Çıktı:** Danışman başına: son aktivite, açık talep/portföy sayısı, ilk temas süresi, bekleyen görev; uyarı eşikleri.
- **Karşılık: VAR (+MÜKERRER).** `danisman-kpi`, `lig`, `ekip/kiyas`, `hedefler`, `pano-tv`, dashboard `Ekip` bloğu, `/app/ekip/[id]`. Beş-altı yerde aynı "danışman performansı" (FEATURE_BACKLOG §d de not etmiş). İlk temas süresi (lead hız SLA) raporu **KISMEN**: `leak-sla` cron var, yapılandırma/rapor ekranı belirsiz (FEATURE_BACKLOG G5).

### İ3. "Ne kazandım? Komisyon ve ciro net olsun"
- **Hikâye:** Ay sonu: toplam komisyon, tahsil edilen/edilmeyen, danışman payları, ofis payı, KDV ve iade/iptal.
- **Çıktı:** Ay/dönem bazında beklenen–gerçekleşen ciro, tahsilat yaşlandırma, danışman hakediş listesi, ofis net payı.
- **Karşılık: VAR.** `/app/komisyon` (+`commission-split-editor`, `bulk-collect`, `commission-simulator`), `commission-cap.ts` (tavan uyarısı), `/app/cuzdan`, `/app/onaylar`, `/app/ekip/kazanc`, `/app/anlasmalar`. Tablolar: `deals`, `commissions`, `expenses`, `targets`. **KISMEN:** tahsilat yaşlandırma ve "ofis net kalan" (komisyon − danışman payı − gider) tek ekranda ayrı bir rapor olarak doğrulanamadı **[DOĞRULANAMADI: raporlarda varlığı]**; `giderler` ile `komisyon` ayrı sayfa, birleşik kâr/zarar görünümü bulunamadı.

### İ4. "Kayıp-kaçak: müşteri, ilan ve para sızmasın"
- **Hikâye:** Ofisin gizli maliyeti: cevapsız lead, rakibe kapanan ilan, unutulan teklif, danışmanın "dışarıdan satması".
- **Çıktı:** Sızıntı listesi, sahibe haftalık özet, neden bazında kayıp raporu.
- **Karşılık: VAR (+MÜKERRER).** `/app/kayip-kacak` (portal kapanışı/SLA), `/app/kayip-satis` (müşteri/anlaşma riski), `anlasmalar/loss-reason-dialog.tsx` (serbest metin), raporlardaki kayıp nedeni, dashboard `KayipKacak` bloğu. İsimler kullanıcıyı karıştırır; **kayıp nedeni kategorisi YOK** (FEATURE_BACKLOG G1). `src/app/app/askida` klasörü menüde yok; rolü doğrulanmadı **[DOĞRULANAMADI]**.

### İ5. "İlan ve portföy kalitesi"
- **Hikâye:** Eski/fiyatı düşmeyen ilan, fotoğrafsız ilan, yetkisi bitmiş portföy, portalda hâlâ yayında olan satılmış mal.
- **Çıktı:** Portföy sağlık skoru (gerçek kurallı), süresi dolan yetkiler, taze ilan oranı, portal teyit durumu.
- **Karşılık: KISMEN.** VAR: `portfoyler` (fiyat geçmişi, medya, filigran, harita), `portallar` (teyit/yenileme/kapanış, scrape yok), `anahtarlar`, `sunumlar`, `portal-teyit` cron. **Önemli tutarsızlık:** `portfoyler/page.tsx:667` boş durum metni "yetki süresi otomatik izlenmeye başlasın" der; kodda yetki bitiş-tarihi kolonu/migration'ı bulunamadı (yalnız `p_authority_confirmed` parametresi, `20260813000000_core_workflow_invariants.sql`). DURUM.md ayrıca "olmayan `authority_expires_at` sorgusu kaldırıldı" diyor. Yani **yetki bitiş takibi vaat ediliyor, veri modeli bulunamadı** (FEATURE_BACKLOG G9 ile örtüşür). Portal yayını gerçek değil (adaptör iskeleti).

### İ6. "Müşteri memnuniyeti ve ofisin adı"
- **Hikâye:** Şikâyet ofisin adını bozar; sahip hangi müşterinin küstüğünü, kimin ilgisiz kaldığını bilmek ister.
- **Çıktı:** Memnuniyet puanı (işlem sonrası anket), şikâyet/olumsuz geri bildirim kuyruğu, tavsiye oranı.
- **Karşılık: KISMEN.** `raporlar/memnuniyet` + `surveys` migration'ı (20260727000104), `tavsiyeler`, müşteri/malik portalı. Eksik: negatif cevapta sahibe anlık uyarı ve ana ekran girişi **[DOĞRULANAMADI: kodda uyarı bağlantısı]**.

### İ7. "Danışman işe alım, performans, çıkış"
- **Hikâye:** Yeni danışmanı hızlı kur, yetkisini kısıtla; ayrılanın müşterisini/portföyünü kaybetme, erişimini anında kes.
- **Çıktı:** Davet, rol/izin, ilk hafta görev listesi; ayrılışta: erişim kapatma + toplu devir + veri sahipliği garantisi.
- **Karşılık: KISMEN.** VAR: `ekip` (davet `invite-actions.ts`, şube, `is_active` pasife alma), `ekip/izinler`, `ayarlar/roller` (matris + kullanıcı istisnası + geçici yetki, migration 067), `ekip/devir` + `ekip/[id]/member-handoff.tsx` (tüm müşteri+portföy tek işlemde devir, onaylı), çöp kutusu, `denetim` (`audit_logs`). YOK/eksik: işe alım/onboarding kontrol listesi (danışman bazlı), çıkış (offboarding) sihirbazı (devir + oturum kapatma + yetki + açık görev/randevu + komisyon alacak hesabı **tek akışta**), açık anlaşma/randevu/görev devri (member-handoff müşteri+portföy diyor; tam kapsam **[DOĞRULANAMADI]**), gizlilik taahhüdü belge takibi.

### İ8. "Hukuk ve evrak düzenim tam olsun"
- **Hikâye:** Yetki belgesi imzalı mı, süresi ne zaman bitiyor, sözleşme imzalandı mı, KVKK/İYS onayı var mı, denetime hazır mıyım.
- **Çıktı:** Tek "uyum karnesi": eksik imza, bitecek yetki, rızasız iletişim, işlenmiş KVKK taleplerinin kaydı; denetim dosyası.
- **Karşılık: KISMEN.** VAR: `sozlesmeler` (şablon+sürüm+SMS OTP e-imza), `uyum` (İYS kayıtları, `kvkk-panel`, imha kaydı), `uyum/denetim-dosyasi`, `belgeler` (4 kaynaktan birleşik liste, uygulama katmanında UNION), `denetim`, `ayarlar/guvenlik` (2FA). YOK/eksik: yetki belgesi bitiş tarihi + uyarı (İ5), EİDS/TTBS elle takip alanı (resmî API doğrulanamadı; G9), dijital yer gösterme tutanağı (G11). Resmî düzenleme referansı olarak FEATURE_BACKLOG şu kaynakları açmış: https://canakkale.ticaret.gov.tr/duyurular/elektronik-ilan-dogrulama-sistemi-eids-ilan-izin-bilgileri-hakkinda-duyuru (EİDS ilan izinleri, TTBS), https://www.mehmetbalcigayrimenkul.com/eids-satilik-ilan-yetki-dogrulama-2026/ (ikincil kaynak; tarihler resmî metinle teyit edilmeli). Hizmet bedeli/KDV oranları kaynaklarda çelişkili: **[DOĞRULANAMADI: güncel oranlar]**. Hukuki tavsiye verilmemeli; yalnız hatırlatma.

### İ9. "Gider, muhasebe ve kasa"
- **Hikâye:** Kira, reklam, portal üyeliği, maaş; ay sonu muhasebeciye düzenli paket.
- **Çıktı:** Gider kategorileri, tekrarlayan giderler, ofis kâr/zarar, muhasebeciye dışa aktarım.
- **Karşılık: KISMEN.** `giderler` (kategori donut, `expenses` tablosu, tanımlanabilir kategori), `aidat`, `komisyon`, ödeme linki (iyzico), `accounting` rolü. Eksik: tekrarlayan gider, bütçe, komisyon+gider birleşik kâr/zarar, muhasebe dışa aktarım formatı **[DOĞRULANAMADI]**; e-fatura iskelet (vaat edilmemeli).

### İ10. "Pazarlama, vitrin, pazar ve rakip"
- **Hikâye:** Ofisin web sitesi ve markası canlı kalsın; mahallede fiyat nereye gidiyor, rakip ne kadar ilanla geliyor.
- **Çıktı:** Vitrin yayını + trafik, kampanya sonuçları, bölge fiyat trendi, ofis payı kıyası.
- **Karşılık: KISMEN.** VAR: `/vitrin/[slug]`, `kampanyalar` (İYS uyumlu), `ayarlar/lead` (lead yakalama), `bolge-analizi` (`region_stats_history`, aylık `bolge-snapshot` cron), `degerleme` (ofis emsali + Endeksa/Tapusor; anahtar yoksa atlanır), `acik-ev`, `projeler`, `yabanci-satis`. YOK: rakip ofis ilan takibi (scrape yok, politika gereği), kampanya→anlaşma kaynak getirisi (KaynakDagilimi bloğu kaynak dağılımını verir, getiriyi vermediği **[DOĞRULANAMADI]**). Ofisler arası ağ (`ag`) rakipten çok iş ortağı.

### İ11 (ek). "Ben yokken ofis dönsün"
- **Hikâye:** Tatilde/hastalıkta onay, istisna, fiyat indirimi kararını vekile bırakma; kritik olay olursa telefonuma düşsün.
- **Çıktı:** Vekâlet (geçici yetki), kural bazlı otomatik onay eşikleri, sahibe yalnız istisna bildirimi.
- **Karşılık: KISMEN.** VAR: geçici yetki (`user_permission_overrides`, migration 067), `onaylar`, `otomasyonlar` + `is-akislari` (playbooks), `gunluk-ozet`, `leak-sla` cron, web push + bildirim zili, `gm`/`branch_manager` rolleri. Eksik: sahibe "yalnız istisna" bildirim profili ve onay eşiği (ör. şu tutarın üstü) tek ekranda; `otomasyonlar` ve `is-akislari` menüde ayrı (MÜKERRER riski).

### İ12 (ek). "Veri bende kalsın" (veri sahipliği ve çıkış)
- **Hikâye:** Danışman ayrılınca müşteri listesi onunla gitmemeli; ofisten ayrılmak ya da sağlayıcı değiştirmek istersem verimi alabilmeliyim; KVKK talebini cevaplayabilmeliyim.
- **Çıktı:** Müşteri/portföy sahipliği ofiste; dışa aktarım yetkisi + günlüğü; tam dışa aktarım; imha kaydı.
- **Karşılık: KISMEN.** VAR: kayıtlar `tenant_id` ile ofise ait, devir paneli, dışa aktarım 2000 satır kesme uyarısı + `audit_logs` kaydı (DURUM.md), çöp kutusu, KVKK imha kaydı, denetim. Eksik: ayrılan danışmanın **erişim kesme + açık oturum sonlandırma + toplu dışa aktarım kısıtı** tek akışta; ofisin tam veri çıkışı (tüm tablolar) için kendin-hizmet dışa aktarım **[DOĞRULANAMADI]**; yedek/PITR doğrulaması ROADMAP'te açık risk (sahibin güveni için "Güven Merkezi" yok).

> İ11+İ12 birleştirilerek "Güven ve devamlılık" tek başlık olarak okunabilir (toplam 10).

## 3. Ana ekran ve menü karmaşıklığı

**Ana ekran (`/app`) sahibe sade mi? Hayır.**
1. 24 `_home` bloğu + hero + dönem seçici; "bugün ne yapmalıyım" tek listede değil. KPI satırı, DonemTrend, Huni, KaynakDagilimi, CanliAkis, PortfoySeridi, KiralamaProje, PortalSagligi, Ekip aynı ekranda; her biri tıklanabilir (iyi) ama ilk ekranda öncelik sırası yok.
2. Rol ayrımı yok: danışmanın "bugünkü müşterilerim" ihtiyacı ile sahibin "ofis nabzı" ihtiyacı aynı bileşen setiyle çözülüyor.
3. `bugun` başlığı altında `Ana ekran` + `Günlük Brifing` + `Ofis kurulumu` + `AI Asistan` = 4 giriş; ilk ikisi içerik olarak büyük ölçüde aynı soruyu cevaplıyor.

**Sayfa sayısı (sahip için fazla mı?) Evet.** Menüde 40 öğe, 9 başlık. Sahibin günlük açacağı sayfa sayısı ölçülmüş değil; uzman tahminim ~12-15 **[DOĞRULANAMADI: kullanım verisi yok]**. Gezinme yükü: performans için 6-8 ayrı yer, para için 3 başlık (Anlaşmalar + Finans + Ekip>Kazanç).

### Mükerrer / karmaşıklık envanteri

| # | Konu | Nerede | Etki |
|---|---|---|---|
| M1 | **Ekip/danışman performansı** | `danisman-kpi`, `lig`, `ekip/kiyas`, `hedefler`, `pano-tv`, `ekip` genel, dashboard `Ekip` + `HedefKarti`, `ekip/kazanc` | En büyük mükerrerlik: sahibin tek sorusu ("ekip nasıl?") 6-8 yerde |
| M2 | **"Bugün" kuyruğu** | `/app` (BugunOzet, Gorevler, Randevular), `/app/brifing`, `gunluk-ozet` cron, `pano-tv`, `gorevler`, `randevular` | İlk bakış dağınık |
| M3 | **Kayıp** | `kayip-kacak`, `kayip-satis`, kayıp nedeni diyaloğu, rapor, dashboard `KayipKacak` bloğu, `askida` | Adlandırma + kayıp nedeni serbest metin (FEATURE_BACKLOG §d) |
| M4 | **Para tablosu** | `komisyon`, `cuzdan`, `onaylar`, `ekip/kazanc`, `anlasmalar`, `giderler`, `aidat`, dashboard `KomisyonAkisi` | Sahip için tek "ofis finans özeti" yok |
| M5 | **Otomasyon/iş akışı** | `otomasyonlar` (settings) + `ayarlar/is-akislari` + `randevu-hatirlat`/`gorev-hatirlat` cron | İki ayrı menü öğesi, benzer mantık (backlog §d) |
| M6 | **Şablon** | `ayarlar/mesaj-sablonlari`, kampanya şablonları, anlaşma kontrol listesi şablonları, sözleşme şablonları | 4 yerde |
| M7 | **Kurulum/ilk gün** | `baslangic`, `sample-data-cta`, `product-tour`, "Başlayalım" kartı, `KurulumSeridi` | Aylar sonra da menüde duruyor |
| M8 | **Arama** | `arama` (Akıllı Arama = çağrı), `arama-sonuclari` (global arama) | İsim çakışması |
| M9 | **Uyum/denetim/belge** | `uyum`, `uyum/denetim-dosyasi`, `denetim`, `belgeler`, `ayarlar/cop-kutusu` | "Evrak düzenim tam mı" sorusuna 5 yer |
| M10 | **Hesaplayıcı** | `hesaplayici`, `kira-artis`, `yatirim` (alias), `degerleme`, public değerleme | Faz 2'de kısmen birleşti; hâlâ birden çok giriş |

## 4. Öneriler

### (a) En yüksek değerli 12 geliştirme

Değer 1-5 (sahip açısından) · Efor S/M/L · Mükerrer riski: yeni yer açıp mevcutla çakışma ihtimali · Migration gerekir mi.

| # | Geliştirme | Değer | Efor | Mükerrer riski | Migration |
|---|---|---|---|---|---|
| 1 | **Sahip ana ekranı: "Bugün karar bekleyenler" ilk blok** (onay bekleyen, kritik kayıp-kaçak, geciken teklif/tahsilat, pasif danışman); diğer bloklar altta katlanır; Brifing ile birleşik | 5 | M | Düşük (mevcut blokları yeniden sıralar) | Hayır |
| 2 | **Yetki belgesi bitiş takibi**: portföye yetki başlangıç/bitiş/tür + 30/15/7 gün uyarısı + filtre + ana ekran sayacı (boş durumdaki mevcut vaadi gerçekleştirir; elle giriş, hukuki tavsiye yok) | 5 | S-M | Düşük | **Evet** (yeni kolonlar + CHECK; mevcut dosyalar değiştirilmez) |
| 3 | **Danışman çıkış (offboarding) sihirbazı**: devir (müşteri+portföy+açık anlaşma+randevu+görev) + erişim kesme + hakediş/alacak özeti + dışa aktarım kilidi, tek onaylı akış; `member-handoff` ve `ekip/devir` bu sihirbazın adımı olur | 5 | M | Orta (mevcut devirle çakışmamalı, genişletmeli) | Muhtemelen hayır (`handoffMemberWorkload` genişler) |
| 4 | **Ofis finans özeti (aylık)**: beklenen–tahsil edilen komisyon, danışman payları, gider, net ofis kalanı, yaşlandırma; Komisyon sekmesi olarak (yeni başlık değil) | 5 | M | Orta (M4'ü azaltmalı) | Hayır; tekrarlayan gider eklenirse evet |
| 5 | **Birleşik "Ekip Performansı" tek kabuk**: danisman-kpi + lig + kıyas + hedefler; ana ekran `Ekip`/`HedefKarti` ve `pano-tv` aynı veri kaynağından beslenir | 4 | M | Azaltıcı | Hayır |
| 6 | **Kayıp nedeni kategorisi (tanım) + kayıp raporu** (`definition-defaults` yeni kategori, `loss-reason-dialog` seçim, raporda grup) — FEATURE_BACKLOG G1/§e ile aynı | 4 | S-M | Düşük | **Evet** (tanım seed; kolon eklenirse) |
| 7 | **Rol bazlı "Sahip modu" menü + ana ekran** (bkz. c): 9 başlık yerine 6, kalanı "Tüm modüller" altında | 4 | S-M | Düşük | Hayır (tercih localStorage/profil; kalıcı istenirse küçük kolon) |
| 8 | **Lead hız SLA raporu + sahibe istisna bildirimi** ("X danışmanda 30 dk+ yanıtsız lead"), `leak-sla` + push altyapısı | 4 | M | Orta (kayıp-kaçakla çakışmamalı) | Hayır/küçük |
| 9 | **Vekâlet ve onay eşiği**: sahip yokken geçici yetki + "şu tutar üstü onaya düşer" kuralı; sahibe yalnız istisna push'u | 4 | M | Orta (`onaylar`/otomasyon ile birleşik tasarım) | Evet (eşik ayarı) |
| 10 | **Uyum karnesi (tek ekran)**: eksik imza, bitecek yetki, İYS rızasız iletişim, KVKK talepleri, 2FA durumu; `uyum` sayfasına özet sekmesi (yeni sayfa değil) | 4 | S-M | Düşük | Hayır |
| 11 | **Memnuniyet uyarısı**: anket düşük puanında sahibe bildirim + müşteri kartında işaret + ana ekranda sayaç | 3 | S | Düşük | Hayır |
| 12 | **Güven ve veri sahipliği sayfası**: ofisin tam veri dışa aktarımı, yedek/restore durumu (yalnız doğrulanınca), danışman erişim günlüğü; ROADMAP P0 yedek provası bitmeden "yedekli" vaadi verilmez | 3 | M | Düşük | Hayır (içerik); toplu iş kuyruğu gerekirse evet |

Sıra, sahibin "para + kontrol + hukuk" önceliğine göre; 1-4 ilk dalga.

### (b) Kaldırılması / birleştirilmesi gerekenler

Hiçbir yol silinmesin (yer imleri); menüden kaldırılır, `NAV_ALIASES`/sekmeye taşınır:

1. `/app/brifing` → Ana ekran "Bugün" bloğuna birleşsin; `bugun` başlığından menü öğesi kalksın (sayfa yönlendirir).
2. `/app/baslangic` (Ofis kurulumu) → kurulum %100 olunca menüden gizlen; yalnız ana ekran şeridi (M7).
3. `danisman-kpi` + `lig` + `ekip/kiyas` + `hedefler` + `pano-tv`: tek "Ekip performansı" kabuğu (M1); `pano-tv` "ekran yayını" düğmesi olur.
4. `kayip-kacak` + `kayip-satis` (+ `askida` doğrulanana dek) → tek "Kayıp ve kaçak" sayfası, iki sekme; kayıp nedeni tek tanım (M3).
5. `otomasyonlar` + `ayarlar/is-akislari` → tek "Otomasyon ve iş akışları" (M5).
6. `giderler` + `aidat` + `ekip/kazanc` + `cuzdan` → Finans başlığında sekmeli tek yer (M4).
7. `uyum` + `uyum/denetim-dosyasi` + `denetim` + `belgeler` → "Uyum ve belgeler" sekmeleri (M9).
8. `arama` (çağrı) adını "Çağrılar" yap; global arama ile çakışma bitsin (M8).
9. `yatirim` alias ve `kira-artis` Kiralama sekmesi zaten yapıldı; tekrar önerilmez.
10. Ana ekranda: `Huni` + `KaynakDagilimi` + `CanliAkis` + `DonemTrend` → "Analiz" katlanır bölümü (varsayılan kapalı); `PortalSagligi` portföy şeridine.

### (c) "Sahip modu" sade menü (nav-config id'leriyle)

Yalnız görünüm tercihi: rol `owner`/`gm` için varsayılan açık, "Tüm modüller" ile tam menü. `module` yetki süzgeci ve paket kapıları aynen geçerli.

| Sahip modu başlığı | Kullanılacak `NAV_SECTIONS` id + öğe href | Not |
|---|---|---|
| **Bugün** | `bugun` → `/app` (Brifing içine birleşir), `/app/asistan` | `/app/baslangic` yalnız kurulum bitmediyse |
| **Ekip** | `ofis` → `/app/ekip` (sekmeler: Genel, Kıyas, Kazanç, Hedefler, Devir) + `performans` → `/app/danisman-kpi` | M1 tek kabuğa taşınınca birleşir |
| **Para** | `finans` → `/app/komisyon`, `/app/giderler`; `anlasmalar` → `/app/anlasmalar` | `aidat` ve `cuzdan` sekme |
| **Kayıp ve fırsat** | `performans` → `/app/kayip-kacak`, `/app/kayip-satis`, `/app/raporlar` | |
| **Portföy ve müşteri (özet)** | `portfoy` → `/app/portfoyler`; `musteriler` → `/app/musteriler`, `/app/talepler` | Operasyon sayfaları "Tüm modüller"de |
| **Uyum ve ayar** | `ofis` → `/app/uyum`, `/app/belgeler`, `/app/ayarlar` (roller dâhil), `/app/abonelik` | `denetim`, `otomasyonlar`, `ayarlar/is-akislari` ayarlar altında |

Sahip modunda gizlenenler ("Tüm modüller"de durur): `/app/eslestirme`, `/app/akilli-listeler`, `/app/tavsiyeler`, `/app/kiralama`, `/app/projeler`, `/app/acik-ev`, `/app/portallar`, `/app/portfoyler/anahtarlar`, `/app/portfoyler/sunumlar`, `/app/ag`, `/app/teklifler`, `/app/sozlesmeler`, `/app/gelen-kutusu`, `/app/arama`, `/app/randevular`, `/app/gorevler`, `/app/kampanyalar`, `/app/degerleme`, `/app/hesaplayici`, `/app/yabanci-satis`, `/app/bolge-analizi`, `/app/pano-tv`, `/app/destek`. Sonuç: yaklaşık 14 öğe / 6 başlık.
Uygulama notu: `NavSection`/`NavItem`'a `ownerMode` bayrağı veya ayrı `OWNER_NAV` listesi; `visibleSections` yetki süzgeci korunur, yeni gate yazılmaz.

### (d) Doğrulanamayan / dikkat edilecek iddialar

1. Yetki belgesi bitiş tarihi veri modeli: migration'larda yetki bitiş kolonu bulunamadı; `portfoyler/page.tsx:667` metni yetki süresi izlendiğini söylüyor. Vaat gerçekten büyük olabilir (kod taraması; canlı DB şeması **doğrulanamadı**).
2. `member-handoff` kapsamı (anlaşma/randevu/görev devri) yalnız dosya yorumundan "tüm müşteri ve portföy" olarak okundu; tam kapsam **doğrulanamadı**.
3. Tahsilat yaşlandırma / net ofis kalanı raporlarının varlığı ve içeriği **doğrulanamadı** (komisyon/rapor sayfaları ayrıntılı okunmadı).
4. Memnuniyet düşük puan uyarısı, kampanya getirisi, muhasebe dışa aktarım formatı **doğrulanamadı**.
5. `askida` rotasının amacı ve menüde olmama nedeni **doğrulanamadı**.
6. "Sahibin açacağı ~12-15 sayfa" tahmini uzman yargısıdır; ölçülmüş kullanım verisi yok, ürün analitiğiyle doğrulanmalı.
7. Taşınmaz Ticareti Yönetmeliği hizmet bedeli/KDV oranları kaynaklarda çelişkili; güncel değer **doğrulanamadı**.
8. EİDS yetki doğrulaması takvim tarihleri ikincil blog kaynaklı; resmî metinle teyit gerekir. Resmî kaynak: Ticaret Bakanlığı duyurusu (§İ8'deki Çanakkale İl Müdürlüğü bağlantısı).
9. Rakip özellik karşılaştırmaları FEATURE_BACKLOG.md'de daha önce açılmış kaynaklara (arveya.com, portfoycrm.com, re-os.com, theclose.com vb.) dayanır; bu turda yeniden doğrulanmadı. Müşteri sayıları site beyanıdır, **doğrulanamadı**.
10. Canlı DB migration sayısı (176 vs 179 dosya) DURUM.md'de **doğrulanmadı** olarak duruyor.
11. Test/build durumu bu turda koşulmadı (kod değişikliği yok).
