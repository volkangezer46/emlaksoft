# Canlı QA Raporu 3 (5a4e0f9, 2026-10-03)

Kapsam: https://emlaksoft.vercel.app, Playwright, 1440 ve 390 genişlik, demo hesapları (Ofis sahibi, Danışman, Süper admin). Önceki rapor: `QA_CANLI_RAPOR_2.md`. Canlıda veri yazılmadı (Kaydet'e basılmadı; yalnız telefon alanlarına yazıldı, yazı boyutu "Çok büyük" denenip "Büyük"e geri alındı). Yeni sürüm canlıda (yeni yönlendirmeler ve rol bazlı ana ekran çalışıyor). Ekran görüntüleri Read ile incelendi.

Özet: 13 maddenin 9'u ÇÖZÜLDÜ, 3'ü KISMEN çözüldü (3, 5, 7), 1'inde YENİ sorun çıktı (13: mobil CLS). P0 yok. P1: 1 (campaign-delivery cron'u canlıda hata veriyor).

## Önceki bulguların durumu

| # | Madde | Durum | Gözlem |
|---|-------|-------|--------|
| 1 | PhoneInput | ÇÖZÜLDÜ | "0544 463 46 44" tam görünüyor: /app/musteriler/yeni (İletişim sekmesi, 1440 ve 390), /app/ekip/yeni (1440), vitrin 'Fiyat düşünce haber ver' (1440, 390). Girdi genişliği 165 / 307 / 361 px, kırpma yok. Kalan görsel not: ülke seçici (TR +90) numaranın üstünde ayrı satıra düşüyor; iki kolonlu formda E-posta kutusu ülke seçiciyle hizalanıyor (YENİ P3). |
| 2 | /app/anlasmalar özet kartları | ÇÖZÜLDÜ (tutar) | 390 ve 1440, açık ve koyu: tutarlar kısaltılmış ve tam ("₺44,3 Mn", "₺20,9 Mn", "₺55 Mn"), kesilme ve "₺" alt satıra düşme yok. Etiketler hâlâ kesiliyor, bkz. YENİ-1. |
| 3 | Müşteri formu özet paneli | KISMEN | Canlı eşleşme önizlemesi artık panelin ÜSTÜNDE (ÇÖZÜLDÜ). Ham anahtar ("phone", "required_keys", "extra_locations") ve "OdaTercih" bitişikliği yok (ÇÖZÜLDÜ). Panel sayfa sonunda eylem çubuğunun üstünde bitiyor, alt çubuk artık örtmüyor (ÇÖZÜLDÜ; panel kendi içinde kaydırmalı, "Talep özeti" satırı kenarda yarım kalıyor). Mobil eylem çubuğu ÇÖZÜLMEDİ: 159 px (hedef ≤ ~88; öncekinden 170 → 159), "Daha fazla" açılınca 215 px. "Daha fazla" menüsü çalışıyor (Taslak kaydet, Kaydet ve yenisini ekle). Çubuk alt menünün üstüne ~10 px biniyor. |
| 4 | /app/lig ve kaynak etiketleri | ÇÖZÜLDÜ | Rol etiketleri Türkçe ("Danışman", "Ofis sahibi", "Genel müdür"); "Advisor/Owner/Gm/won" yok. Müşteri listesinde "Sahibinden.com", "Ofis Ziyareti", "Tavsiye / Referans" okunur. |
| 5 | Sol menü 1440x900 | KISMEN | Sade görünümde 8 tam satır + 9. (Komisyon) yarım görünüyor (önceden ~7). "DAHA FAZLA" hâlâ kaydırmadan görünmüyor (y≈973, pencere 900). "Çok büyük" (20 px): rozet artık taşımıyor (ÇÖZÜLDÜ), 7 satır görünüyor, "KULLANIM" etiketi "KULLA..." kısalıyor. Yazı boyutu uygulanıp "Büyük"e geri alındı (çerez 1.large). |
| 6 | Ürün turu adım 4 | ÇÖZÜLDÜ | 1440: vurgu arama kutusunda (Ctrl K'lı alan). 390: vurgu yok ve metin hâlâ "Bilgisayarda Ctrl+K kısayolu da açar" diyor (YENİ P3). |
| 7 | /app/baslangic | KISMEN | Yüzde tutarlı: ana ekran şeridi "Kurulum %67 (4/6)", /app/ayarlar %67, başlangıç %67 (ÇÖZÜLDÜ). 390'da yatay taşma 119 px SÜRÜYOR (ÇÖZÜLMEDİ). Kök neden: adım çipi listesi `ol.overflow-x-auto` içindeki `span.sr-only` (" (tamamlandı)") konumlandırılmış ata yok, kaydırma kabından kaçıp belgeyi 509 px'e genişletiyor. Çözüm: `ol`ye `relative` (veya `sr-only` yerine kabın içinde konumlanma). |
| 8 | Vitrin ilan | ÇÖZÜLDÜ | Talep formu kapalıyken "Talep bırak" metni yok. Harita yükleniyor (OSM karoları, 390'da görüldü) ve "Haritayı aç" + "Google Haritalar'da aç" bağlantıları var. Küçük artık: 390'da boş bir sabit çubuk (25 px, `fixed bottom-0 border-t`, içinde boş `div`) kalıyor (YENİ P3). |
| 9 | /admin sistem sağlığı | ÇÖZÜLDÜ | /admin/sistem: "26/27 Sağlıklı cron" yani 27 iş (vercel.json ve CLAUDE.md ile uyumlu). "Tanımsız iş" notu görünmüyor (gerek de yok). Bir iş "Hata": campaign-delivery, bkz. YENİ-2. |
| 10 | Mükerrer uyarısı (Danışman) | ÇÖZÜLDÜ (kod doğrulandı) | Canlıda test: 0532 100 00 03 yazınca uyarı "Mehmet Demir, telefon, Danışman, 67 gün önce" gösterdi. Demo Danışman 25 müşterinin tamamını kendi kaydı olarak görüyor (liste Ofis sahibiyle aynı), bu yüzden başkasına ait kayıt canlıda üretilemedi. `src/lib/duplicate-finders.ts`: `visibleIds` yalnız `officeWide` veya `assigned_to === userId` için dolu; kapsam dışı kayıtta ad, danışman ve son temas sorgulanmıyor (`DuplicateHit.visible=false`). Sızıntı yok. Kaydet'e basılmadı. |
| 11 | Yeni: rol bazlı ana ekran ve yönlendirmeler | ÇÖZÜLDÜ | Danışman ana ekranı: "SIRADAKİ EN İYİ EYLEM · 6 görevin gecikmiş · Gecikenleri aç". Ofis sahibi: "Bugün karar bekleyenler" (3 onay bekleyen talep, ₺272.000 kaçan komisyon, 7 geciken kira). /app/brifing → /app. /app/performansim açılıyor (Özet, Aktivite, Öncül göstergeler, Pipeline, Hedef, Kazanç, Koçluk). /app/cuzdan "Kazanç": sahipte "Benim kazancım" ve "Ofis geneli" sekmeleri (?sekme=ofis/benim çalışıyor), danışmanda yalnız kişisel hakediş (sekme yok). Ekip Merkezi sekmeleri: Genel, Kıyas, Danışman KPI, Ekip Ligi, Hedefler, Devir / Atama. Yönlendirmeler: /app/arama → /app/gelen-kutusu?sekme=cagri, /app/eslestirme → /app/talepler?sekme=eslesme, /app/ayarlar/duyurular → /app/bildirimler?sekme=duyurular, /admin/hatalar → /admin/sistem?sekme=hatalar, /app/ekip/kazanc → /app/cuzdan?sekme=ofis. Danışmanda /app/ekip → /app?yetki=yok. |
| 12 | Portföy ve anlaşma detay sekmeleri | ÇÖZÜLDÜ (URL) | `?sekme=kapanis` ("Kapanış": Kazanıldı kapanış sihirbazı) ve `?sekme=zaman` ("Zaman çizelgesi") aktif sekmeyi etiketli gösterip içerik açıyor, hem anlaşma hem portföyde. Pasif sekmeler yalnız ikon (YENİ P3). Tıklama otomasyonla seçilemedi: sekmeler `role=tab` değil. |
| 13 | Konsol, 4xx/5xx, taşma, CLS | KISMEN | /app, /app/musteriler, /app/portfoyler: konsol hatası ve 4xx/5xx YOK, yatay taşma YOK. CLS 1440: 0,025 / 0,005 / 0,005 (iyi). 390: /app 0,159 (YENİ P2; eşik 0,1), musteriler 0,000, portfoyler 0,0003. |

## Yeni bulgular

| # | Sayfa | Genişlik | Ne görüldü | Öncelik | Tahmini dosya |
|---|-------|----------|-----------|---------|---------------|
| YENİ-2 | /admin/sistem (cron) | 1440 | "Kampanya teslimat kuyruğu" (campaign-delivery, 2 dakikada bir) "Hata: campaign_claim_failed:23514" (check constraint ihlali) veriyor; RAPOR_2'deki "1 hatalı: campaign-delivery" düzelmedi, kampanya teslimatı canlıda durmuş olabilir | P1 | src/app/api/cron/campaign-delivery/route.ts, kampanya claim SQL/migration (check kısıtı) |
| YENİ-1 | /app/anlasmalar, /app/musteriler, /app/cuzdan (Kazanç) | 390 ve 1440 ("Çok büyük" dahil) | StatRow/StatCard etiketleri çok dar kalıyor: "Kaz an...", "Ağırl ıklı...", "Kazanıla n" (kelime ortasından kırılma), "Bekleyen bakiye (tahsil...)", müşteri listesi "Topla m...", "Yeni son...", "Mülk sah..." (Çok büyük). İkon+etiket+ok üçlüsü etiketi sıkıştırıyor | P2 | src/components/ui (StatCard/StatRow); ok ikonunu etiketin altına al veya etiket 2 satıra serbest bırak |
| YENİ-3 | /app | 390 | CLS 0,159 (kayma); 1440'ta 0,025 | P2 | src/app/app/page.tsx (karar kartları / selamlama bloğu, odometer; yükseklik ayır) |
| YENİ-4 | Müşteri/portföy formu | 390 | Sabit eylem çubuğu 159 px (bkz. madde 3); çubuk alt menünün ~10 px üstüne biniyor | P2 | FormActionBar (tek satır: İptal + Kaydet + "Daha fazla" simgesi, durum rozetini üst satıra değil çubuk dışına) |
| YENİ-5 | Sol menü | 1440x900 | "DAHA FAZLA" hâlâ ilk ekranda yok; alt kullanım kartı (Kullanım + PROFESYONEL + Vitrin görüntüle) ~100 px yer tutuyor; "KULLANIM" etiketi "KULLA..." kısalıyor | P2 | src/components/app/app-sidebar.tsx |
| YENİ-6 | /app/baslangic | 390 | Yatay taşma 119 px (madde 7 kök neden: sr-only span, `ol` konumsuz) | P2 | src/app/app/baslangic/* (adım çipi listesi) |
| YENİ-7 | Telefon girişi | 1440 ve 390 | PhoneInput ülke seçici ayrı satırda; iki kolonlu formda yanındaki E-posta kutusu seçiciyle hizalanıyor, numara kutusu altta | P3 | src/components/ui/phone-input.tsx |
| YENİ-8 | Vitrin ilan (talep kapalı) | 390 | Boş sabit alt çubuk kalıyor (25 px, çizgili) | P3 | src/app/vitrin/[slug]/[id]/* (sticky CTA: içerik yoksa render etme) |
| YENİ-9 | Ürün turu | 390 | Adım 4'te vurgu yok; metin "Bilgisayarda Ctrl+K kısayolu da açar" mobilde anlamsız | P3 | src/app/app/product-tour.tsx |
| YENİ-10 | /admin/sistem cron listesi | 1440 | Bazı işlerin özeti ham JSON ({"claimed":0,"completed":0,...} public-mutation-outbox, geo-province-sync) | P3 | src/app/admin/sistem/* (özet biçimleyici) |
| YENİ-11 | /app/anlasmalar/[id] Kapanış | 1440 | "Durum: paid" ham İngilizce değer | P3 | src/app/app/anlasmalar/[id]/* (kapanış sihirbazı, komisyon durumu etiketi) |
| YENİ-12 | Detay sayfaları, mobil alt menü | 1440, 390 | Pasif ikon sekmeler etiketsiz (tooltip/aria-label doğrulanamadı); "Ana ekran" alt menüde hâlâ iki satıra bölünüyor ("Ana / ekran") | P3 | detay sekme çubuğu, mobil alt gezinme |
| YENİ-13 | /app/lig, /app/danisman-kpi | 1440 | Podyumda yalnız 1. kişi; geniş boş alan ve dolu renkli blok (RAPOR_2 #19 aynen duruyor) | P3 | podyum bileşeni |

## Doğrulanan kalan davranışlar

- Koyu tema /app'te uygulanıyor; anlaşmalar koyu 1440'ta okunur.
- Ekip yeni kayıt ve müşteri yeni kayıt formlarında özet panelinde telefon gerçek değerle yansıyor ("0544 463 46 44").
- Süper admin /admin açılıyor, /admin/hatalar yönleniyor, konsol/ağ hatası yok.
- Demo oturumu tek kullanıcı gibi davrandığı için betikler yeniden girişle ardışık çalıştırıldı.
