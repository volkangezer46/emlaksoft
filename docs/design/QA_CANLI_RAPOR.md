# Canlı QA Raporu (https://emlaksoft.vercel.app, 3 Ekim 2026)

Yöntem: Playwright, 1440x900 ve 390x844. Yalnız gezinme; hiçbir Kaydet/Sil basılmadı (kayıp nedeni diyaloğu açıldı, Vazgeç ile bırakıldı). Roller: Ofis sahibi, Danışman, Süper admin. Ekran görüntüleri gözle incelendi.

## Özet
- Konsol hatası: 0 (tüm sayfalar). 4xx/5xx: 0 (admin'de tahmin ettiğim /admin/ofisler ve /admin/abonelikler 404 verdi; bunlar gerçek rota değil, bulgu sayılmaz).
- Yatay taşma (scrollWidth>innerWidth): hiçbir sayfada yok (1440 ve 390).
- P0: yok. P1: yok (aşağıda en yüksek P2).
- Sticky sidebar: sayfa 800px kaydırılınca sidebar top=0, yükseklik 900 (doğru).

## Navigasyon süresi (domcontentloaded + h1/main, ms; ilk yük dahil)
| Sayfa | 1440 | 390 |
|---|---|---|
| / | 2285 | 883 |
| /fiyatlar | 413 | 251 |
| /app | 1875 | 1830 |
| /app/musteriler/yeni | 1213 | 975 |
| /app/talepler/yeni | 682 | 802 |
| /app/portfoyler | 843 | 1457 |
| /app/musteriler | 1051 | 1288 |
| /app/ekip | 1131 | 828 |
| /app/anlasmalar | 1006 | 1404 |
| /app/ayarlar/tanimlar | 681 | 790 |
Ekip sekme geçişi (tıklama -> networkidle): Kıyas 3327, Kazanç 1254, Hedefler 1683, Devir/Atama 6284 ms.

## Çalışanlar
- Ana sayfa: hero, üst menü (Ürün/Çözümler/Fiyatlandırma/Kaynaklar), mobil menü, ürün turu (7 çip), bento, güvenlik, fiyat, SSS, footer sorunsuz. (Tam sayfa screenshot'taki boş bölgeler scroll-reveal animasyonu kaynaklı; viewport'ta içerik dolu.)
- /fiyatlar: Aylık/Yıllık anahtar ve 4 paket kartı render oluyor. (Slider/hesaplayıcı bulunamadı, bkz. bulgu 3.)
- /app yeni koyu sidebar: bölüm daralt/aç (PORTFÖY "BÖLÜMÜ AÇ"e döndü), ikon-only mod 64px, bölüm ikonuna hover flyout (alt öğeler + hızlı eylemler), Ctrl+K komut paleti (canlı sonuç, "AI Asistan'a sor"), "Yeni" menüsü (kısayol rozetleri), kullanım kartı, rozetler (bildirim 9+, mobil Menü 3).
- /app/musteriler/yeni: Talep ve kriterler sekmesi, telefon/e-posta girince sağ özet "Cep · biçim geçerli" ve "Girildi" gösteriyor; il/ilçe alanları, Ek bölge ekle, ray daralt düğmesi, taslak kaydı ("Taslak kaydedildi 16:01").
- Liste kiti (/portfoyler, /musteriler): KPI, görünüm değiştirici (Liste/Kart/Harita), çipler, sağlık çubuğu çalışıyor.
- Ekip Merkezi 5 alt sekmesi açılıyor; Danışman rolü kazançta yalnız kendini görüyor ("Başkasının kazancını görme izniniz yok") ve /app/ekip -> /app?yetki=yok yönlendirmesi çalışıyor.
- Anlaşmalar kayıp nedeni diyaloğu: 7 neden çipi, not alanı, "Kayıp olarak işaretle" (koyu temada da okunur). Ayarlar > Tanımlar > "Aşama adları": 5 aşama, kilitli Kazanıldı/Kaybedildi, renk + Kaydet.
- /admin: Süper admin paneli, koyu tema, rozetler, dev-mod MFA uyarı bandı görünüyor.

## Bulgular

| # | Ciddiyet | Sayfa / genişlik | Görülen | Tahmini dosya |
|---|---|---|---|---|
| 1 | P2 | /app/* koyu tema, 1440 | Üstteki sekme çubuğunda aktif sekme etiketi ("Müşteriler") koyu zemin üstünde neredeyse okunmuyor (düşük kontrast). Açık temada sorun yok. | src/app/theme-dark.css, üst sekme bileşeni (MorphTabs / module-tabs) |
| 2 | P2 | /app/musteriler/yeni, 390 | Bölüm rayı mobilde yalnız aktif adımı ("Kişi") gösteriyor; diğer bölümlere atlama yolu yok (yalnız "Sonraki"). Özet paneli sayfa altında, sabit Kaydet çubuğunun arkasında kalıyor. | src/components/ui (form ray / wizard), musteriler/yeni |
| 3 | P2 | /fiyatlar, 1440 | Sayfanın üst menüsü ana sayfadan farklı (yalnız "Giriş / Demo talep et"; Ürün/Çözümler/Fiyatlandırma/Kaynaklar yok, logo ikonsuz). Etkileşimli hesaplayıcı (slider/input[type=range]) bulunamadı; yalnız Aylık/Yıllık anahtarı var. Kapsam hesaplayıcı bekleniyorsa eksik. | src/app/fiyatlar/page.tsx, landing header bileşeni |
| 4 | P2 | /app/*, 1440 | Sidebar "SON KULLANILANLAR" bölümü her gezinmede büyüyor (3 öğeye kadar) ve ilgili öğeleri yineliyor; aktif öğe (örn. Ayarlar) görünür alanın dışına itiliyor (/app/talepler/yeni ve /app/ayarlar'da aktif/alt öğeler alttaki kullanım kartının altında kesiliyor, "Tavsiyeler" yarım). Aktif öğe scrollIntoView yapmıyor. | src/components/app/app-sidebar.tsx |
| 5 | P2 | /admin, 1440 | Sidebar marka bloğu: "EmlakSoft Platform SÜPER ADMİN" 3 satıra taşıp üstten kesiliyor; "ANALİZ" bölüm başlığı kullanım kartının altında yarım kalıyor. | src/components/admin/admin-sidebar (marka bloğu) |
| 6 | P2 | /app/ekip sekme geçişi | Devir/Atama 6.3 sn, Kıyas 3.3 sn (ilk yük); diğerleri 1.2-1.7 sn. Yavaş sorgu veya sıralı fetch şüphesi. | src/app/app/ekip/devir/page.tsx, ekip/kiyas/page.tsx |
| 7 | P3 | /app/ekip/kazanc, 1440 | Danışman tablosu kartı 920px'te bitiyor, sağında boş alan (tam genişlik değil). | ekip/kazanc tablo sarmalayıcısı |
| 8 | P3 | /app/portfoyler, 1440 | Tablonun son sütun başlığı ("FİYAT SAĞLIĞI") kenarda kısmen kesiliyor (kart içi yatay kayma). | portföy liste kiti tablo bileşeni |
| 9 | P3 | /app/musteriler/yeni | İsteğe bağlı "Talep ve kriterler" boş olduğu halde yeşil tik alıyor (2/5 tamam) ama "İletişim"de olmuyor tutarsız; "Müşteri türü" select yerel stil. | musteriler/yeni ilerleme hesabı |
| 10 | P3 | /app (Ana ekran) | KPI kartı etiketleri kırpılıyor ("Yeni müşteri · 30 ...", "Son 4 hafta ekl..." 390'da). | ana ekran StatCard |
| 11 | P3 | /app/ekip/hedefler | "Yeni hedef" düğmesi kalın koyu çerçeve içinde (diğer sayfaların başlık eylemleriyle tutarsız); hedefler Temmuz 2026 dönemi, ekim ayında güncel dönem yok. | src/app/app/hedefler |
| 12 | P3 | /app/ayarlar/tanimlar | Breadcrumb son halka "Ayrıntı" (genel ad). | breadcrumb eşlemesi |
| 13 | P3 | Mobil menü (390 ana sayfa) | "Ücretsiz dene" iki kez (üst çubuk ve alt CTA). | landing mobil menü |
| 14 | P3 | /app/anlasmalar | Tutarlar ekran okuyucu/metinde çift okunuyor ("44.300.000 ₺ 44.300.000 ₺"), muhtemelen sr-only yinelemesi; Danışman rolünde toplamlar ofisle aynı (44,3 Mn): rol kapsamı doğrulanmalı. | anlaşma tahtası KPI + RLS kapsamı |
| 15 | P3 | /admin | Kırmızı/sarı "Sistem DİKKAT: Veritabanı yanıt veriyor, 1 hatalı cron" gerçek sinyal; hatalı cron incelenmeli (UI hatası değil). | cron heartbeat |

Not: MorphTabs ekip alt sekmelerinde aktif sekme genişleyip gölgeli oluyor ama pasifler de etiketli kalıyor ("küçülür" tam ikon-only değil; 390'da ikon-only). Koyu temada dialog ve formlar okunur.
