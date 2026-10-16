# TV Modu v2 — Ofis duvar ekranı (sahne tabanlı)

Kaynak istek (sahip, 2026-10-16): "harika bir tema olmuş bu. bunu örnek al… tv modunu geliştir zenginleştir. daha kaliteli
içerik…". Görsel dil: v4 referansı (lacivert + altın, cam paneller, fotoğraf zeminler). Rotalar: oturumlu `/app/pano-tv`,
eşleşmiş cihaz `/tv` (OA6). İkisi aynı `TvBoard` bileşenini ve aynı `loadTvData` yükleyicisini kullanır.

## 1. Neden yeniden kurgu

v1 tek ekranlık bir "kart ızgarası"ydı: 9 küçük kart aynı anda, uzaktan okunması zor, fotoğraf yok, ayarlar cihaza
(localStorage) bağlı. Duvar ekranı bir **yayın**dır, bir tablo değil: 3–5 m'den tek bakışta okunan, tek konuya odaklanan,
sırayla dönen **sahneler** gerekir (spor/borsa yayınlarının dili).

## 2. Sahneler (sıra ve süre ayarlanabilir)

| # | Kimlik | Ne gösterir | Varsayılan |
|---|--------|-------------|-----------|
| 1 | `bugun` | Randevu zaman çizelgesi (şimdi çizgisi, "Sıradaki"), bugün/geciken görevler, yeni talepler | 20 sn |
| 2 | `performans` | 5 büyük KPI (ciro\*, kazanılan anlaşma, yeni müşteri, yeni talep, gelen arama), geçen ayın aynı günlerine göre değişim, 14 günlük alan + çubuk grafik | 18 sn |
| 3 | `lig` | Podyum (SVG madalya), 4–10. sıra, gün serisi, hedef halkaları | 18 sn |
| 4 | `ilanlar` | "Yeni portföyler" (terim sözlüğü: ofisin kaydı portföydür): tam ekran kapak fotoğrafı (Ken Burns), ₺ tam fiyat, ilçe, oda, m², Yeni/Fırsat rozeti | 30 sn |
| 5 | `hedefler` | Ofis hedef halkası + **ay sonu tahmini (hız)**, şube hedefleri, danışman halkaları | 15 sn |
| 6 | `duyurular` | Duyurular, "Satış kapandı" kutlamaları, iş yıldönümleri, yeni rozetler | 15 sn |
| 7 | `sistem` | Portal başına yayındaki ilan + teyit sağlığı, veri tazeliği, bağlantı türü | 10 sn |

\* Ciro yalnız "TV'de para göster" açık **ve** izleyicide `earnings_all` varsa; eşleşmiş cihazda hiçbir koşulda.

## 3. "Akıllı" kararlar

1. **İçerik farkında rotasyon** — boş sahne yayına girmez (duyuru yoksa duyuru sahnesi atlanır; kapak fotoğrafı yoksa
   ilan sahnesi atlanır). Ekranda asla "veri yok" kartları dönmez. `bugun` her zaman vardır (anlamlı boş durum).
2. **Günün saatine göre vurgu** — 11:00'e kadar `bugun` sahnesi 1,5×, 16:00 sonrası `lig` 1,25× sürer (sabah plan,
   akşam skor). Saf fonksiyon `planScenes` (test edilir).
3. **Olay kesmesi** — yeni kabul edilen teklif (anlaşma) realtime ile gelince rotasyon durur, tam ekran
   "Satış kapandı!" kutlaması (danışman kısa adı, ilçe, ayın kaçıncı anlaşması) + 4 sn hafif konfeti; bitince kaldığı
   yerden devam. İlk yüklemede kutlama yok (yalnız *yeni* kimlikler).
4. **Ay sonu hızı** — hedef sahnesi yalnız yüzde değil, "bu hızla ay sonu ≈ N" tahmini gösterir (etiketli tahmin).
5. **Gece modu** — 22:00–07:00 arası sahneler durur; yalnız logo + saat, düşük parlaklık (panel ömrü, burn-in, enerji).
6. **Tazelik dürüstlüğü** — son başarılı veri 3 dakikadan eskiyse canlı nokta "Gecikmeli"ye döner; bağlantı yoksa
   son veri gösterilmeye devam eder, rozet "Bağlantı yok".
7. **Kiosk sağlığı** — Wake Lock, tam ekran, 3 sn hareketsizlikte imleç + araç çubuğu gizlenir, dakikada bir ±2 px
   piksel kayması, her gün 04:00'te (İstanbul) tek yeniden yükleme (bellek sızıntısı / sürüm güncellemesi).

## 4. Gizlilik (herkese açık oda)

- Müşteri telefon / e-posta / adres hiç **seçilmez** (sorgu düzeyinde), DTO'da yoktur.
- Bütün kişi adları `shortName` ile **"Ahmet Y."** biçimine iner (müşteri ve personel); tam ad istemciye gitmez.
- Görev başlığı TV'ye taşınmaz (serbest metin; numara/ad içerebilir) — yalnız görev türü, danışman kısa adı, saat.
- Doğum günü **gösterilmez**: personel doğum tarihi `advisor_private` (KVKK, yalnız owner/gm + kendisi) tablosundadır;
  TV'ye çıkarmak açık rıza ister. Yerine iş yıldönümü (`advisor_profiles.hired_at`, hassas olmayan iş verisi) kutlanır.
- Belge görselleri (tapu, kimlik…) kapak olamaz: `firstPublicImageByProperty` (KVKK P0-9). Cihazda kapaklar yalnız
  herkese açık görsel ucundan (`/api/property-media/<id>`, yalnız yayındaki ilan) gelir.
- Cihaz kapsamı salt okunur: `immutableReadonlyPermissions`, izleyici kimliği yok, para kapalı.

## 5. Ayarlar (ofis ayarları kayıt defteri)

Tek anahtar `office.tv.config` (JSON, `tenant_settings`, köprü ayarı → yalnız Pano TV çekmecesinden yazılır;
yetki `settings:edit` + TV rolü). İçerik: sahne sırası/açık-kapalı/süre, tema (koyu/açık), para göster, gece modu.
Bütün ofis ekranları (oturumlu + eşleşmiş cihazlar) bir sonraki yoklamada aynı ayarı alır. **Migration yok**
(`tenant_settings` zaten var; anahtar kodda tanımlanır).

## 6. Teknik

- Veri: `/api/app/tv-data` (oturum, realtime `tenant:<id>` + 60 sn yedek yoklama) ve `/api/tv/data` (cihaz, 20 sn).
- Geçişler: iki katman (giren/çıkan) yalnız `opacity` + `transform`; ilerleme çubuğu `scaleX` CSS animasyonu
  (`animation-play-state` ile duraklar). Ken Burns CSS. Konfeti ~120 parçacıklı tek `<canvas>`, 4 sn, `prefers-reduced-motion`'da hiç çizilmez.
- Ağır kütüphane yok (grafikler el yapımı SVG, renkler CSS token). CSP: satır içi script yok.
- Cam paneller `backdrop-filter` KULLANMAZ: akıllı TV işlemcilerinde fotoğraf üstü bulanıklık kare düşürür (cam bütçesi
  sözleşmesi); yarı saydam lacivert + ince kenar aynı görünümü verir.
- Ölçek: `--u = min(0.9cqw, 1.6cqh)`; 1366×768, 1920×1080 ve 3840×2160'ta orantılı.
- Klavye: ←/→ sahne, Boşluk/P duraklat, F tam ekran, S ayarlar.

## 7. Bilinçli olarak yapılmayanlar

- Doğum günü (KVKK, yukarıda). Cihazda ciro (güvenlik kararı OA6 korunur). Kayan yazı (okunmuyor; duyurular sahnede).
- Sistem sağlığında cron nabzı (platform verisi; ofis ekranına ait değil).
