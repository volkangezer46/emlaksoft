# Persona: Saha Emlak Danışmanı — Ne İster, EmlakSoft Ne Veriyor?

Durum: ÖNERİ/denetim belgesi. Kod ve migration DEĞİŞTİRİLMEDİ.
Yöntem: yalnız depo okuması (`src/lib/nav-config.ts`, `src/app/app/**`, `public/manifest.webmanifest`, `public/sw.js`,
`src/components/app/app-sidebar.tsx`, `palette-core.ts`, `keyboard-shortcuts.tsx`, `docs/design/*`). Dış kaynak kullanılmadı, istatistik yoktur.
"Kaç dokunuş" değerleri koddan sayılan alan/adım sayılarıdır (cihazda zamanlanmadı). Durum etiketleri: VAR / KISMEN / YOK / MÜKERRER.
Bu belge saha danışmanı bakışıyla yazılmış varsayım + kod doğrulamasıdır; gerçek kullanıcı görüşmesiyle doğrulanmalıdır.

## 1. Tipik gün (özet)

Sabah plan (randevu, görev, aranacaklar) → arayan müşteri (kimdi, ne aramıştı) → sahada ilan alma (telefonla, fotoğraf, fiyat, komisyon)
→ ilan metni ve portal yayını → talep eşleştirme, müşteriye WhatsApp ile öneri → yer gösterme ve not → teklif/pazarlık →
sözleşme → komisyon payı ve ödeme günü → hedef/sıralama → ertesi gün takip. Çoğu iş ayakta, tek elle, zayıf çekimde olur.

## 2. Ölçümler (koddan)

### 2.1 Telefondan 3 kritik iş

Mobil alt çubuk (`app-sidebar.tsx:359`): Ana ekran, Müşteri, Portföy, Randevu + Menü. Üstte "Yeni" menüsü (`quick-create-menu-body.tsx`, 2 dokunuş: menü + kayıt türü).
Ana ekranda "Hızlı eylem" çipleri (`_home/musteriler-hizli.tsx`): Yeni müşteri, Yeni portföy, Arama kaydı, Randevu planla.

| İş | Yol | Dokunuş (ana ekrandan) | Alan | Zorunlu | Not |
|---|---|---|---|---|---|
| Müşteri ekle | Hızlı eylem "Yeni müşteri" → `musteriler/yeni` | 1 + form + Kaydet | 5 sekme: Kişi 3 (ad, tür, şube*), İletişim 4 (telefon, e-posta, il, ilçe), Talep kriterleri, Özel günler 3, Not 1; yaklaşık 11 sabit alan + talep alanları | 1 (Ad soyad) | Telefon İKİNCİ sekmede (İletişim); "ad + telefon" için sekme geçişi gerekir. (*şube yalnız şubeli ofiste) |
| Görüşme/not kaydet | "Arama kaydı" → `arama` (`call-console.tsx`) | 1 + müşteri seç + yön + sonuç kodu + Kaydet | Müşteri, telefon, yön, sonuç, süre (sn), not | Telefon + sonuç (cevapsız hariç) | Müşteri kartından hızlı not yolu doğrulanmadı (`customer-timeline-tab.tsx` var, ekleme yolu ayrıntılanmadı). "Süre (sn)" sahada sürtünme. |
| Randevu ekle | Alt çubuk "Randevu" → liste → Yeni, ya da Yeni menüsü → "Yeni randevu" | 2 + form + Kaydet | 8 alan, 2 sekme: Zaman 4 (tür, süre, tarih, saat), Katılımcı 4 (müşteri, portföy, konum, not) | 3 (tür, tarih, saat; tarih/saat ön dolgulu) | Müşteri/portföy arama kutusu var (iyi). Hızlı eylem çipi "Randevu planla" yeni formu değil LİSTEYİ açar (+1 dokunuş). |

Yorum: üç işin hiçbiri tek ekranlık "hızlı kayıt" (bottom sheet) değil; hepsi tam sayfa sekmeli form. Zorunlu alan sayısı düşük (iyi), ama sekme ve alan yoğunluğu telefon için ağır.

### 2.2 İlan (portföy) girişi

`portfoyler/yeni/property-tabs.ts`: 5 sekme, 22 etiketli alan. Zorunlu 5: başlık, işlem türü (varsayılan Satılık), portföy türü (varsayılan Daire), liste fiyatı, KOMİSYON ORANI.
Konum, kat/ısınma/yaş/cephe/ada-parsel isteğe bağlı. Taslak otomatik (yalnız hassas olmayan alanlar). Fotoğraf yüklemesi YENİ formda yok; detayda `property-media-manager.tsx` (`capture="environment"` ile kamera, VAR).
Sürtünmeler: (1) başlık zorunlu: saha danışmanı başlığı bilmeden önce yer/tip bilir; otomatik üretilebilir (mahalle + oda + tür). (2) Komisyon oranı zorunlu: sahada henüz konuşulmamış olabilir; ofis varsayılanı önceden dolu gelmeli. (3) Fotoğraf kayıttan SONRA başka sayfada: "kaydet → detay → medya". (4) Harita noktası (`lat-lng-picker.tsx`) var; "bulunduğum konumu kullan" doğrulanmadı.

### 2.3 "Bugün" ekranı danışmana özel mi?

KISMEN / ŞÜPHELİ. `app/page.tsx` + `_home/*`: selamlama kişisel (ad), bölümler Görevler, Randevular, Sıcak müşteri, Kayıp-kaçak, KPI, Hedef, Komisyon akışı, Huni, Portal sağlığı, Ekip, Canlı akış, Kaynak dağılımı.
`HomeCtx` (page.tsx) kullanıcı kimliği (profil id) taşımıyor; `_home/data.ts` görev sorguları (`status=open`, tarih aralığı) `assigned_to=ben` süzgeci uygulamıyor görünüyor: kapsam yalnız RLS/yetki veri kapsamına (`permission-data-scope.ts::hasOfficeWideDataScope`) bağlı olabilir. Doğrulanmadı; kontrol edilmeli. Sahip/müdür için "ofis" ekranı, danışman için "benim günüm" ekranı ayrı olmalı: ofis bölümleri (ekip, huni, kaynak, portal sağlığı) danışmanda gürültüdür.
`/app/brifing` (Günlük Brifing) ayrı sayfa olarak var ve ana ekran özetiyle örtüşüyor (MÜKERRER riski).

## 3. İhtiyaç başlıkları

Her başlık: iş hikâyesi, hedef dokunuş, EmlakSoft karşılığı.

### İ1. Sabah planı: "Bugün kimi arayacağım, nereye gideceğim?"
Hikâye: Sabah telefon açılır; bugünkü randevular (saat, adres, müşteri), geciken takipler, doğum günleri tek akışta görülür.
Hedef: uygulamayı açınca 0 dokunuş, satırdan arama/yol tarifi 1 dokunuş.
Karşılık: KISMEN. `app/page.tsx`, `_home/gorevler.tsx`, `_home/randevular.tsx`, `_home/bugun-ozet.tsx`; `randevular/rota-view.tsx` + `route-suggestion.tsx` (rota önerisi VAR); `brifing`. Eksik: danışmana özel süzgeç (2.3), "bugün arayacaklarım" tek liste, satırda tek dokunuş ara/WhatsApp.

### İ2. Arayan müşteri: "Kim bu, ne aramıştı?"
Hikâye: Bilinmeyen numara; danışman geçmişi, talebi, son konuşulan ilanı görmek ister.
Hedef: 1 dokunuş görüntüleme, 2 dokunuş not.
Karşılık: KISMEN. `arama/call-console.tsx` (müşteri kartı, skor, talep notu), `gelen-kutusu`, komut paleti araması (`command-search.tsx`). Gerçek arayan tanıma YOK (santral/CTI dış bağımlılık, FEATURE_BACKLOG G6).

### İ3. Sahada ilan girişi (telefonla)
Hikâye: Mal sahibinin evinde 5 dakikada: tür, oda, m², fiyat, konum, 6 fotoğraf. Sonrası akşam tamamlanır.
Hedef: konum + fotoğraf + 4 alanla taslak en çok 5 dokunuş (bkz. 2.2).
Karşılık: KISMEN. `portfoyler/yeni` (taslak VAR, `PROPERTY_DRAFT_FIELDS`), `property-media-manager.tsx` (kamera VAR, kayıttan sonra), `lat-lng-picker.tsx`. Eksik: tek ekran "hızlı ilan" (başlık otomatik, komisyon varsayılan, fotoğraf aynı ekranda), sesle not.

### İ4. Fotoğraf, video, ilan metni
Hikâye: Fotoğraflar sıralı, filigranlı; ilan metni saniyeler içinde hazır.
Hedef: metin 1 dokunuş üret + 1 dokunuş kopyala.
Karşılık: VAR. `portfoyler/[id]/ai-content-panel.tsx`, `components/app/copy-listing-text.tsx`, `ayarlar/filigran`, `portfoyler/[id]/brosur`, `portfoyler/sunumlar`, `property-media-manager.tsx`. Mükerrer riski: sunum, broşür, ilan metni üç yüzey.

### İ5. Portal yayını
Hikâye: İlanı portallara tekrar yazmadan yayınlamak, düşen/bayatlayan ilanı fark etmek.
Hedef: 2 dokunuş (ilan → yayınla), durum rozeti ilan kartında.
Karşılık: KISMEN. `portallar` (Portal Kontrol), `portfoyler/[id]/portal-listing-actions.tsx` (güncelle/kaldır YALNIZ API anahtarı tanımlı ve adaptörü olan portallarda), `actions/portal-publish.ts`. Adaptörsüz portallarda dışa aktarma/kopya akışı doğrulanmadı.

### İ6. Talep eşleştirme ve müşteriye WhatsApp önerisi
Hikâye: Yeni ilan girince "bu ilana uyan 4 müşterim var"; ilan 1 dokunuşla WhatsApp'tan gider; ilgilenirse randevu.
Hedef: eşleşmeden WhatsApp 2 dokunuş; "gönderildi" durumu kayıtlı.
Karşılık: KISMEN. `eslestirme`, `lib/matching.ts`, `lib/match-notify.ts` (yeni ilanda bildirim VAR), `components/app/whatsapp-link.tsx`, `wa-template-menu.tsx`, `musteriler/[id]/matched-properties-widget.tsx`, `ayarlar/mesaj-sablonlari`. Eksik (ADVISOR_AND_MATCHING_SPEC.md §1-A ile uyumlu): "önerildi/gönderildi/randevu" durumu kayıtlı değil; bildirim talep SAHİBİ danışmana değil ilanı ekleyene gidiyor.

### İ7. Yer gösterme, tutanak ve geri bildirim
Hikâye: Gösterim sonrası arabada 30 saniyede: ilgi derecesi, itiraz, sonraki adım.
Hedef: randevu kartından "tamamla" 2 dokunuş (sonuç + not), sonraki adım görev olarak.
Karşılık: VAR/KISMEN. `randevular/complete-appointment-dialog.tsx` (tamamlama VAR), `acik-ev`, `onaylar`. Yer gösterme tutanağı için `sozlesmeler`/`belgeler` var; hazır şablon ve mobil imza doğrulanmadı.

### İ8. Teklif, pazarlık, sözleşme
Hikâye: Alıcı teklifi geldi, satıcıya iletilir, karşı teklif; kabulde sözleşme ve anlaşma açılır.
Hedef: teklif kaydı 3 dokunuş; kabulden anlaşmaya 1 dokunuş.
Karşılık: VAR. `teklifler`, `anlasmalar`, `sozlesmeler` (`/yeni` n-kısayolları ile). Eksik: pazarlık turlarının tek zaman çizgisi ve sahada hızlı giriş doğrulanmadı.

### İ9. Komisyon payım ve ne zaman ödenir
Hikâye: Danışman "ne kazandım, ne zaman yatar" cevabını ofise sormadan görmek ister.
Hedef: 1 dokunuş.
Karşılık: KISMEN. `cuzdan` (Cüzdanım: tahmini/ödenen, bordro çıktısı VAR), `komisyon`, `ekip/kazanc`. Zayıf noktalar (ADVISOR_AND_MATCHING_SPEC §1-B): pay `profile_id` ile değil metin etiketiyle bağlı (kırılgan); "hakediş/ödeme günü" ayrı durum değil (müşteri tahsilatına bağlı); "beklenen ödeme tarihi" alanı doğrulanmadı.

### İ10. Hedef, sıralama, motivasyon
Hikâye: Ay sonuna ne kaldı; ekip içindeki yerim.
Hedef: ana ekranda 0 dokunuş.
Karşılık: VAR. `_home/hedef-karti.tsx`, `hedefler`, `lig` (Ekip Ligi), `danisman-kpi`. Mükerrer riski: danisman-kpi, lig, ekip/kiyas, ekip/kazanc, hedefler beş ayrı yüzey (danışman için tek "Performansım" yeterli).

### İ11. Takip hatırlatmaları ve veri hijyeni
Hikâye: "3 gündür dönmedi, aramam gereken 5 kişi".
Hedef: otomatik; danışman yalnız onaylar.
Karşılık: VAR. `gorevler`, `otomasyonlar`, `kayip-kacak`, `akilli-listeler`, `musteriler/[id]/next-best-action.ts`, bildirim (`push-subscribe.tsx`). Eksik: danışman diliyle "bugün aranacaklar" tek ekran (bkz. İ1).

### İ12. Tapu, evrak, ofisle iletişim
Hikâye: Tapu bilgisi, ada/parsel, müşteri belge fotoğrafı, ofisle ilan/ödeme onayı.
Hedef: belge yükleme 2 dokunuş (kamera); onay talebi 2 dokunuş.
Karşılık: KISMEN. `portfoyler/[id]/tapu-inquiry-panel.tsx` (tapu/parsel içgörü), `musteriler/[id]/customer-files-tab.tsx`, `belgeler`, `onaylar`, `destek`, `ag` (ofisler arası ağ). Resmî tapu sistemi entegrasyonu yok (içgörü paneli; uyum için `docs/TURKIYE_UYUM_NOTLARI.md`).

### İ13. Mobil, zayıf internet, çevrimdışı
Hikâye: Bodrum katta çekim yok; yazılan not kaybolmamalı.
Hedef: yazma çevrimdışı çalışır, bağlantı gelince gönderilir.
Karşılık: KISMEN/ZAYIF. PWA VAR: `manifest.webmanifest` (standalone, 3 kısayol: Portföyler, Müşteriler, Görevler), `sw.js` v6 (`offline.html`, push). `sw.js` bilinçli olarak /app sayfalarını ÖNBELLEĞE ALMAZ (gizlilik, fail-closed): çevrimdışıyken yalnız "çevrimdışısınız" sayfası; kayıt kuyruğu/IndexedDB yok (`indexedDB`/`navigator.onLine` kullanımı bulunmadı; `public-mutation-outbox` cron'u public portal içindir). Form taslakları (`use-form-draft.ts`) yalnız hassas olmayan alanları saklar (ad/telefon/not yok). Manifest ikonu yalnız SVG (Android/iOS kurulum ikonları için PNG gerekebilir, cihazda test edilmeli). Mobil alt çubuk VAR.

### İ14. Kişisel marka ve veri sahipliği
Hikâye: Kartvizit, kişisel vitrin, WhatsApp'ta paylaşılabilir profil; danışman ayrılırsa müşteriler kimde kalır.
Hedef: kartvizit paylaşımı 2 dokunuş; devirde müşteri verisi ofiste kalır (sorumlu ofis).
Karşılık: VAR/KISMEN. `ekip/kartvizitim`, `musteriler/[id]/vcard`, `actions/agent-profile.ts`; devir: `ekip/devir`, `bulkAssignCustomers`, `handoffMemberWorkload`, `ekip/[id]/member-handoff.tsx` (müşteri+portföy). Talep/görev/randevu/açık anlaşma devri yok/doğrulanmadı (ADVISOR_AND_MATCHING_SPEC §1-B). Danışman bazlı kişisel vitrin sayfası doğrulanmadı.

## 4. (a) En değerli 12 geliştirme

Efor: S en çok 2 gün, M en çok 1 hafta, L daha fazla (tahmin, ölçüm değil).

| # | Geliştirme | Değer | Efor | Mükerrer riski | Migration |
|---|---|---|---|---|---|
| 1 | Danışmana özel "Bugün": görev/randevu/müşteri sorgularına `assigned_to=ben` süzgeci + sahip/müdür için "Ofis" görünümü anahtarı; bugün aranacaklar listesi (satırda Ara/WhatsApp) | Çok yüksek | M | `_home/*`, `brifing`, `gorevler` ile örtüşür; brifing birleştirilmeli | Yok |
| 2 | Hızlı kayıt çekmecesi (bottom sheet): müşteri (ad+telefon+not), görüşme notu, randevu (müşteri+saat); tam formlar "Ayrıntı ekle" bağlantısı | Çok yüksek | M | `musteriler/yeni`, `arama`, `randevular/yeni`; aynı server action'lar yeniden kullanılır | Yok |
| 3 | Hızlı ilan: başlık otomatik, komisyon ofis varsayılanı, fotoğraf aynı ekranda, "konumumu kullan" | Çok yüksek | M | `portfoyler/yeni` içine "hızlı mod"; yeni sayfa açma | Yok (varsayılan komisyon tenant ayarı gerekirse Evet) |
| 4 | Müşteri/portföy kartında mobil sabit eylem şeridi: Ara (tel:), WhatsApp, Not, Randevu | Yüksek | S | `whatsapp-link.tsx`, `wa-template-menu.tsx` var; birleştirme | Yok |
| 5 | Eşleşme → WhatsApp → randevu akışı ve "önerildi/gönderildi" durumu; bildirimi talep sahibi danışmana da gönder | Yüksek | M | `eslestirme`, `match-notify.ts` genişler; ADVISOR_AND_MATCHING_SPEC ile aynı madde | Evet (öneri durum alanı/tablosu) |
| 6 | Çevrimdışı not/görüşme kuyruğu: yalnız yazma taslağı IndexedDB'de (oturumla sınırlı), bağlantı gelince gönderim; sayfa önbelleği AÇILMAZ (sw.js fail-closed korunur) | Yüksek | L | `use-form-draft.ts` genişler; KVKK incelemesi şart | Yok |
| 7 | Danışman için tek "Performansım + Cüzdanım" ekranı (hedef, sıra, tahmini komisyon ve ödeme tarihi) | Yüksek | M | `danisman-kpi`, `lig`, `ekip/kazanc`, `hedefler`, `cuzdan` beş yüzey: BİRLEŞTİR, yenisi ekleme | Ödeme tarihi için Evet (hakediş durumu/beklenen tarih) |
| 8 | Komisyon payını `profile_id`'ye bağla (etiket yerine) + hakediş durumu | Yüksek | M | `commission-split-editor.tsx`, `cuzdan` | Evet (splits şeması; geriye dönük taşıma) |
| 9 | Randevu tamamlamada "sonraki adım" (görev/arama/teklif) ve ilgi derecesi; yer gösterme tutanağı şablonu | Orta-yüksek | M | `complete-appointment-dialog.tsx` genişler; `sozlesmeler` şablonu | Yok/Evet (ilgi alanı) |
| 10 | Portal yayın durumu ilan kartında + adaptörsüz portal için "hazır metin+foto paketi" dışa aktarma | Orta-yüksek | M | `portallar`, `portal-listing-actions.tsx` | Yok |
| 11 | Danışman kişisel vitrin/kartvizit paylaşımı (bağlantı, QR, WhatsApp paylaşımı) | Orta | M | `ekip/kartvizitim`, vcard, vitrin; aynı veri kaynağı | Slug için Evet olabilir |
| 12 | Devir kapsamını talep, görev, randevu, açık anlaşmaya genişlet; danışman ayrılış kontrol listesi | Orta | M | `ekip/devir`, `member-handoff.tsx` genişler | Yok (toplu güncelleme) |

## 5. (b) Sürtünme noktaları ve kaldırılabilecek alan/adımlar

En büyük 3: (1) Telefonda üç kritik iş de tam sayfa sekmeli form (müşteride telefon ikinci sekmede). (2) Bugün ekranı danışmana göre süzülmüyor, ofis kalabalığı taşıyor. (3) Çevrimdışı/zayıf çekimde yazılan her şey kaybolabilir (kuyruk yok).

Kaldırılabilecek/ertelenebilecek:
- Müşteri formu: telefonu "Kişi" sekmesine taşı (ad+telefon aynı ekran); Özel günler (doğum, yıldönümü, not) ve Şube ilk kayıtta gizle ("Daha fazla" altında). E-posta isteğe bağlı kalsın.
- Görüşme kaydı: "Süre (sn)" kaldır; "yön" son seçimi hatırlasın; müşteri seçilince telefon otomatik dolsun (telefon zorunlu ve ayrıca isteniyor).
- Portföy formu: başlığı zorunlu olmaktan çıkar (otomatik), komisyon oranını ofis varsayılanıyla doldur; alan içermeyen "Ek bilgi" sekmesini bilgilendirme bandına çevir; fotoğrafı formda sun.
- Randevu: "Süre" ve "Konum" varsayılan (ör. 60 dk; seçilen portföyün adresi) gelsin; iki sekmeyi tek ekrana indir.
- Hızlı eylem çipi "Randevu planla" doğrudan `randevular/yeni`ye gitsin (şu an liste, +1 dokunuş).
- Tekrar: "Yeni" menüsü + hızlı eylem çipleri + komut paleti + n-kısayolları aynı eylemleri üç yerde sunuyor (kısayollar klavye: mobil için yararsız).
- Günlük Brifing ile ana ekran özeti örtüşüyor (MÜKERRER): birini diğerinin içine al.
- Menü: 9 başlık ve ~45 sayfa; danışmanın günlük işi için ~20 öğe yeterli (bkz. §6).

## 6. (c) Danışman için sade menü önerisi (nav-config id'leriyle)

Öneri: yeni sayfa açmadan, danışman rolü için menüyü "benim işim" odaklı göster (sayfalar silinmez, URL çalışır). Şu an `NAV_SECTIONS` rol bilmiyor, yalnız modül iznine göre süzüyor (`visibleSections`): rol/tercih bayrağıyla "sade görünüm" yapılabilir; izin matrisini kısıtlamak yerine menü gizleme önerilir.

Önerilen çekirdek (bölüm id → öğe href):
- `bugun`: `/app` (Ana ekran, danışman görünümü), `/app/asistan` (AI Asistan)
- `musteriler`: `/app/musteriler`, `/app/talepler`, `/app/eslestirme`
- `portfoy`: `/app/portfoyler`, `/app/portallar` (Portal Kontrol), `/app/acik-ev`
- `anlasmalar`: `/app/anlasmalar`, `/app/teklifler`, `/app/sozlesmeler`
- `iletisim`: `/app/gelen-kutusu`, `/app/randevular`, `/app/gorevler`, `/app/arama` (Akıllı Arama = görüşme kaydı)
- `finans`: `/app/komisyon` (sekme: `/app/cuzdan` Cüzdanım); Giderler/Aidat/Onaylar yönetici işi
- `performans`: `/app/danisman-kpi` (sekme: `/app/lig`), tek "Performansım" girişi
- `araclar`: `/app/degerleme`, `/app/hesaplayici`

Danışman menüsünde gizlenecek/ikincil: `/app/baslangic` (Ofis kurulumu), `/app/brifing` (ana ekrana al), `/app/akilli-listeler`, `/app/tavsiyeler`, `/app/kiralama` + `/app/kira-artis` (kiralama yapmıyorsa), `/app/projeler`, `/app/portfoyler/anahtarlar`, `/app/portfoyler/sunumlar` (portföy içinden), `/app/ag`, `/app/kampanyalar`, `/app/giderler`, `/app/aidat`, `/app/raporlar`, `/app/kayip-kacak`, `/app/bolge-analizi`, `/app/kayip-satis`, `/app/pano-tv`, `/app/yabanci-satis`, tüm `ofis` bölümü (`/app/ekip`, `/app/otomasyonlar`, `/app/ayarlar/is-akislari`, `/app/uyum`, `/app/belgeler`, `/app/denetim`, `/app/abonelik`; `/app/destek` kalabilir; `/app/ayarlar` yalnız profil/kartvizit).
Ofis sahibi/GM/şube müdürü tam menüyü görmeye devam eder.

## 7. (d) Mobil öncelik listesi

Sıra: etki/efor.
1. Alt çubuğa sabit "+ Hızlı ekle" düğmesi (müşteri, not, randevu, ilan); mevcut 4 sekme + Menü (`app-sidebar.tsx:359`) korunur. Hızlı kayıt çekmecesi (geliştirme #2).
2. Müşteri/portföy kartında sabit alt eylem şeridi: Ara, WhatsApp, Not, Randevu (#4).
3. Ana ekranı danışmana özel yap; "bugün aranacaklar" ve randevu satırında yol tarifi (#1).
4. Hızlı ilan (#3): kamera formda, konum al.
5. Çevrimdışı yazma kuyruğu (#6); önce yalnız not ve görüşme.
6. Manifest: PNG ikonlar (192/512, maskable) ve kısayollara "Yeni müşteri", "Yeni randevu", "Arama kaydı" (mevcut 3 kısayol yalnız liste sayfaları).
7. Tek el: formlarda alt sabit "Kaydet" çubuğu; telefon klavyesi (PhoneInput zorunlu, VAR); tarih/saat yerel seçiciler (`type=date/time` VAR).
8. Push (`push-subscribe.tsx`, sw push VAR): yeni eşleşme ve randevudan önce hatırlatma danışmana özel ayarlanır (mevcut kapsam doğrulanmadı).
9. `g`/`n` klavye kısayolları mobilde değersiz; mobilde ipucunu gizle.

## 8. Açık doğrulamalar (kodda kesinleşmeyenler)

- `_home/data.ts` görev/randevu sorgularının danışman kapsamı (RLS mi, uygulama süzgeci mi).
- Müşteri 360'ta tek dokunuşla not ekleme var mı (`customer-timeline-tab.tsx`).
- Vitrinde danışman bazlı kişisel sayfa.
- Adaptörsüz portallar için yayın/kopya akışı.
- PWA PNG ikon gerekliliği (cihazda test).
- Tapu paneli resmî sorgu değil içgörü; hukuki ifade eklenmemiştir.
