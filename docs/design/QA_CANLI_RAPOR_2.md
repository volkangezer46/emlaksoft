# Canlı QA Raporu 2 (63eeddc, 2026-10-03)

Kapsam: https://emlaksoft.vercel.app, Playwright, 1440 ve 390 genişlik, demo hesapları (Ofis sahibi, Danışman, Süper admin). Canlıda veri yazılmadı (Kaydet'e basılmadı; yalnız tercih anahtarları değiştirilip geri alındı). Tüm sayfalarda konsol hatası ve 4xx/5xx isteği YOK; yatay taşma yalnız /app/baslangic 390'da.
Not: Ekran okumaları otomasyonla yapıldı; 'olası' etiketli maddeler tam doğrulanamadı.

## Bulgular

| # | Sayfa | Genişlik | Ne görüldü | Öncelik | Tahmini dosya |
|---|-------|----------|-----------|---------|---------------|
| 1 | /app/musteriler/yeni, /app/ekip/yeni, vitrin ilan 'Fiyat düşünce haber ver' | 1440 | PhoneInput numara alanı dar kolonda ~60 px; "05X"/"053" kesiliyor, numara okunamıyor | P1 | src/components/ui/phone-input.tsx (min-w / sarma), form 3 kolon yerleşimi |
| 2 | /app/anlasmalar | 390 (ve koyu 1440) | StatRow kartlarında tutar kesiliyor ("44.300.000" sağdan kırpılıyor, etiketler "Ağırlıklı tahm…" kısalıyor); 1440'ta "₺" alt satıra düşüyor | P1 | src/components/ui (StatCard/StatRow), src/app/app/anlasmalar/page.tsx |
| 3 | /app/musteriler/yeni (özet paneli) | 1440 | Özet paneli 2926 px içerik, iç kaydırmalı ve alt kısmı sabit eylem çubuğunun altında kalıyor; "Canlı eşleşme önizlemesi" (çalışıyor, test: "1 portföy eşleşiyor, skor 73") panelin en altında, fiilen keşfedilemiyor | P2 | form kabuğu özet aside, müşteri formu |
| 4 | aynı | 1440 | Özet panelinde ham anahtarlar görünüyor: "phone", "required_keys", "extra_locations"; etiket+rozet bitişik: "OdaTercih", "Min m²Tercih" | P2 | müşteri formu özet alan etiket eşlemesi |
| 5 | /app/baslangic | 390 | Yatay taşma 119 px; Ofis adı/Telefon girişleri kart dışına taşıyor | P2 | src/app/app/baslangic/* |
| 6 | Mobil formlar (/musteriler/yeni, /portfoyler/yeni) | 390 | Sabit eylem çubuğu ~170 px (3 satır, alt menü üstünde); form alanı yarım ekrana iniyor, ilk alanların altı örtülüyor | P2 | FormActionBar |
| 7 | Ürün turu /app?tur=1 | 1440+390 | Adım 4 "Arama kutusu" vurgusu TV modu düğmesini gösteriyor, arama kutusunu değil. Mobilde metin "Ctrl ve K", "üzerine gelip" | P2 | src/app/app/product-tour.tsx |
| 8 | /app sol menü | 1440x900 | Alt kullanım kartı + Vitrin satırı ~250 px kaplıyor; çekirdek menüde ~7 satır görünür, "DAHA FAZLA" kaydırmadan görünmüyor; "Çok büyük" yazıda 5 satır, "PROFESYONEL" rozeti taşıyor, arama "Ad, telefon ve…" kısalıyor; "SON KULLANILANLAR" ek 3 satır yer yiyor | P2 | src/components/app/app-sidebar.tsx |
| 9 | /app/lig | 1440 | Ham rol anahtarları "Advisor", "Owner", "Gm", "Branch_manager" ve "Kazanılan (won) anlaşma" İngilizce; isim tutarsız ("Danışmansen" / "Danışman") | P2 | src/app/app/lig/page.tsx |
| 10 | /app/musteriler liste | 1440 | Kaynak ham değer: "portal_sahibinden", "ofis_ziyareti" | P2 | müşteri listesi kaynak etiket eşlemesi |
| 11 | /app/anlasmalar/[id] | 1440 | Pipeline aşama hapları (Nitelikli/Müzakere/Kazanıldı) koyu zeminde düşük kontrast; ikinci düzey sekmeler yalnız ikon (aktif olan etiketli) | P2 | src/app/app/anlasmalar/[id]/* |
| 12 | Vitrin ilan /vitrin/demo-ofis/[id] | 1440+390 | "Talep formu şu anda kapalı." (demo ofis ayarı olabilir) ama mobil sabit çubuk yine "Talep bırak" gösteriyor; harita (OSM iframe) boş gri alan + pin, karo yüklenmedi (olası, headless kaynaklı olabilir) | P2 | src/app/vitrin/[slug]/[id]/* |
| 13 | /admin | 1440 | Sistem sağlığı "28 cron işi, 1 hatalı: campaign-delivery"; CLAUDE.md "27 route" der (sayı tutarsız) | P2 | src/app/admin (sistem sağlığı), vercel.json |
| 14 | /app/baslangic, /admin/marka | 1440 | Yerel tarayıcı dosya girişi İngilizce ("Choose File / No file chosen") | P3 | dosya girişi bileşeni |
| 15 | /app/ayarlar | 1440 | Kurulum "%30"; ana ekran ve Başlangıç "%67 (4/6)" gösteriyor, tutarsız | P3 | src/app/app/ayarlar/page.tsx |
| 16 | /app/musteriler/[id] | 1440 | Ad yanında açıklamasız beyaz nokta; "Müşteri skoru" etiketi halka dışına taşıyor | P3 | müşteri detay başlık bileşeni |
| 17 | Birçok /app sayfası | 1440 | Sekme başlığı genel ("EmlakSoft — Türkiye'nin emlak işletim sistemi"), sayfa adı yok | P3 | metadata (ilgili page.tsx) |
| 18 | Mobil alt menü | 390 | "Ana ekran" etiketi iki satıra bölünüyor | P3 | mobil alt gezinme |
| 19 | /app/danisman-kpi, /app/lig | 1440 | Podyumda yalnız 1. kişi; geniş boş alan ve dolu renkli blok | P3 | podyum bileşeni |
| 20 | /app/musteriler/yeni | 1440 | İl arama menüsü yukarı açılıp üst kenarı kırpılıyor; bütçe alanı binlik ayraçsız ("3000000"); breadcrumb "Yeni kayıt" / başlık "Yeni müşteri" farklı | P3 | combobox, form alanları |
| 21 | Portföy detay (Kiralandı) | 1440 | Kiralanmış portföyde "Anlaşma + komisyon oluştur" formu ve "yayına alındığında…" metni görünüyor | P3 | src/app/app/portfoyler/[id]/* |
| 22 | Boş durumlar | 1440 | İllüstrasyon yalnız /app/ag, /yabanci-satis (ikon), /franchise, /destek, /giderler, /portallar'da; belgeler, tavsiyeler, ice-aktarma, mesaj-sablonlari düz metin | P3 | ilgili sayfalar, EmptyState |

## Çalışanlar (doğrulandı)

1. Marka: giriş, landing (açık/koyu yatay), /app ve /admin menü logosu yeni; favicon bağlantıları (favicon.ico, icon.svg, /brand/favicon-32.png, /brand/apple-touch-icon.png) 200 döner; /icon.png ve /apple-icon.png 404 (kullanılmıyor). /admin/marka: 4 yükleme alanı (açık/koyu logo, sembol, favicon), canlı önizleme, sekme ve mobil ana ekran önizlemesi çalışıyor (yükleme yapılmadı).
2. Kullanıcı menüsü: Sade görünüm anahtarı (kalıcı, geri alındı), Yazı boyutu Normal 16px / Büyük 18px (varsayılan) / Çok büyük 20px kalıcı ve uygulanıyor (geri alındı). Sade menü: çekirdek + "Daha fazla"; Danışman hesabında sade menü çalışıyor. Ctrl K komut paleti açılıyor (kısayollar N+H/M/T/P/R/G/A, ipucu satırı).
3. /app/yardim 4 sekme (Başlangıç, Rehberler, Sözlük, Destek talebi); HelpTip '?' 6 yerde (müşteriler, portföyler, komisyon, lig, eşleştirme, kayıp-kaçak) açılıyor, dokunma hedefi 49 px; ürün turu 5 adım (mobilde 4) çalışıyor; /app/baslangic 6 adımlı sihirbaz; /app/hos-geldin danışmanda "Merhaba… Dört kısa adım" (Profilim/Hedefim/İlk müşterim/Bugünkü görevlerim), sahipte /app'e döner.
4. /app/hizli: Müşteri / Görüşme notu / Randevu 3 sekme, 390'da düzgün.
5. Formlar: alt Kaydet/İptal çubuğu (durum rozeti, "N zorunlu alan eksik", Taslak kaydet, Kaydet ve yenisini ekle, kısayol ipucu); özet panelinde telefon, e-posta, il GERÇEK değer (il seçince "İstanbul"); Talep ve kriterler sekmesi; canlı eşleşme önizlemesi veri döndürüyor; mükerrer uyarısı ("Bu kişi ofiste kayıtlı olabilir", ad, eşleşme tipi, danışman, son temas, Kaydı aç / Yine de yeni kayıt) çalışıyor. /portfoyler/yeni (4 bölüm), /randevular/yeni (2 bölüm) 1440 ve 390 açılıyor.
   Mükerrer uyarısı notu: danışman hesabında da kayıtlı müşterinin adı gösteriliyor; başka danışmana ait kayıtta davranış (kimlik sızıntısı) demo verisiyle doğrulanamadı, kod incelemesi önerilir.
6. Müşteri detayı: Zaman çizelgesi (Tümü/Görüşme/Randevu/Teklif/Anlaşma/Görev kategori çipleri, sayaçlar) çalışıyor; portföy ve anlaşma detayı açılıyor, taşma ve konsol hatası yok (Kapanış sekmesi içerik olarak açılıp doğrulanamadı: ikon sekmeleri otomasyonla seçilemedi).
7. Ekip Merkezi (Genel, Kıyas, Kazanç, Hedefler, Devir/Atama), /app/ekip/yeni 5 bölüm (Kimlik, Rol ve yetki, Atama ve kapsam, Hedefler, Davet). Danışman: /app/ekip kapalı (/app?yetki=yok), /app/ekip/kazanc "Ekip arkadaşlarınızın kazançları gizlidir" yalnız kendi payı, /app/komisyon "Yalnız sizin payınız", /app/anlasmalar yalnız kendi anlaşmaları (5 kazanılan, sahipte 10).
8. Liste sayfaları (talepler, anlaşmalar, teklifler, sözleşmeler, randevular, görevler, kiralama) ve dashboardlar (/app, danisman-kpi, lig, hedefler) 1440 ve 390'da hatasız, taşmasız açılıyor; koyu tema (sistem) uygulanıyor.
9. /admin: Ofis 360 (Zaman çizelgesi, Abonelik ve ödemeler, Destek, Kullanım ve limitler, Ekip ve oturumlar, Yasal ve onaylar, Fatura profili), /admin/personel/yeni (3 bölüm), /admin/duyuru açılıyor.
10. Vitrin /vitrin/demo-ofis: 8 ilan, filtreler, ilan detayı, mobil sabit "Talep bırak" çubuğu, fiyat alarmı formu; konsol/ağ hatası yok.
11. Sticky sidebar: kaydırmada sabit kalıyor (1440).
