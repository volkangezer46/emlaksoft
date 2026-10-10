# EmlakSoft UX Değerlendirmesi (2026-10)

Kaynak: ürün sorgulayıcı ajan (salt-okunur kod incelemesi). Kullanıcı şikâyeti: "Havuz menüsünü göremiyorum, menü karışık; Google gibi tek arama kutusu sadeliği istiyorum."

## 1. Mevcut bilgi mimarisi
- nav-config: 9 başlık, 35 menü öğesi, 55 sekme hedefi, 74 tıklanabilir hedef; `/app` altında 164 page.tsx.
- Ofis sahibi: 10 satır (Ana ekran, Randevular, Görevler, Müşteriler, Talepler, Portföyler, İlan Kontrol, Anlaşmalar, Komisyon, Raporlar) + "Diğer"de 25 öğe. Derinlik 5-6 kat.
- Danışman 8, muhasebe 6, çağrı 5, salt-okunur 6 satır.
- Mobil alt çubuk sabit (Bugün, Müşteriler, Portföy, Anlaşmalar, Daha fazla); rol çekirdeğine bakmıyor (nav-config.ts:675-680, app-sidebar.tsx:419-487).
- Ana ekran ~30 `_home` bileşeni; hero'da kapsam, dönem, Düzenle, +Müşteri, TV simgesi bir arada.

## 2. Özellik bulunabilirliği
| Özellik | Durum | Yol / not |
|---|---|---|
| Danışman uzmanlık alanları + bölgeleri | VAR | Diğer > Ekip Merkezi > danışman > "Uzmanlık ve bölgeler" (4-5 tık); listede uzmanlık/bölge sütunu yok |
| İlan havuzu | VAR ama gizli | Portföyler 4. sekme (nav-config.ts:195); menüde/ana ekranda yok |
| Gelen ilanın havuza düşmesi | YARIM | Havuz varsayılan KAPALI (20260816001200:26); `enqueueListingPool` yalnız elle ekleme (actions/properties.ts:398) ve içe aktarmada (import-data.ts:651); portal/ağ/API/eklenti kaynaklarında yok |
| Uzmanlığa göre atama | VAR, karışık | Havuz kartında öneri + ayrıca "Danışmansız ilanlar" (office-center/smart-assign); 6 çip, 5 KPI |
| Danışman kimlik/kişisel | VAR | Aynı veri 3 adla (Kimlik ve kişisel / Profil ve belgeler / Bilgiler); form 9 sekme |
| Danışman tam takip | VAR, dağınık | Danışman 360 (10 sekme, jargon: Öncül göstergeler, Koçluk, Pipeline) + Ofis Kontrol + Ekip karnesi + Ofis Merkezi |
| Demo veri + "Gerçek kullanıma geç" | VAR, iyi | Kapatılamaz şerit (demo-trial-strip.tsx:39), 2-3 tık |
| Demo veride danışman/uzmanlık/havuz | YOK | sample-data/** içinde listing_pool, advisor_specialties, advisor_regions yok |
| Kurulum sihirbazı | VAR, ikiye bölünmüş | `/app/baslangic` (8 adım) + `/app/ayarlar/profil-tamamla` |
| Kurulum sonrası tanıtım | VAR | 4 rol turu; sahip turunun "ilan-havuzu" adımı hedefsiz (data-tour yalnız setup-wizard.tsx'te) |
| TV modu | VAR, keşfedilemez | `/app/pano-tv`; yalnız etiketsiz simge (ana-hero.tsx:103); palette "tv" Ekip karnesi'ne gidiyor (nav-config.ts:408) |

## 3. Persona takılmaları (özet)
- Sahip "ilanı ata": Portföyler > İlan Havuzu > (havuz kapalıysa `<details>` ayarı) > kart > Ata; 6 çip, jargon (SLA, sahiplenme).
- Sahip "bugün ofiste ne oldu": kapsam varsayılanı "Benim işlerim" (page.tsx:101), dönem yok "Bugün" (ana-hero.tsx:90), canlı akış kapalı "Daha fazla"da.
- Sahip "yeni danışman": Diğer > Ekip Merkezi > Yeni danışman, 9 sekmeli form.
- Danışman "komisyonum": menüde yok; Performansım içinde.
- Telefon: "Daha fazla" çekmecesi masaüstü menünün 31 öğelik kopyası; ana ekran 10+ blok dikey yığın.

## 4. Birleştir / çıkar / sadeleştir
- BİRLEŞTİR Ekip Merkezi + Ofis Merkezi (aynı AdvisorTable; ofis-merkezi/page.tsx:74). Ofis Merkezi "Atamalar" sekmesini ÇIKAR.
- BİRLEŞTİR Tanımlar x3 (Ofis Merkezi Tanımlar, /app/ayarlar/tanimlar, /app/ayarlar/merkez).
- SADELEŞTİR "Ayarlar" adlı 5 sekme → gerçek adlar (Etiketler, Filigran, Şablonlar, Mesaj şablonları, AI kullanımı) (nav-config.ts:147,196,294,315,445).
- BİRLEŞTİR Roller + Yetkilendirme; Denetim + Ofis Kontrol + Canlı akış; performans yüzeyleri (uzun vadeli).
- SADELEŞTİR İlan Havuzu sayfası (tek "Bekleyen" liste, ayar/geçmiş ikincil, "Gecikenler"); iki sihirbazı tek "Kurulum"; danışman formu 3 adım.
- GİZLE (varsayılan kapalı modül): Ofis Ağı, Yabancı satış, Mahalle notları, Açık Ev, Projeler.
- Jargon: SLA→Gecikmiş, Pipeline→Satış hattı, Kıyas→Karşılaştır, Öncül göstergeler/Koçluk sadeleştir.

## 5. Google yaklaşımı
- Ana ekran tepesinde "Ne yapmak istiyorsun?" kutusu → mevcut palet (`OPEN_PALETTE_EVENT`, palette-core `getAppGoItems`/`getAppActions`), örnek çipler; niyet sözcük tablosu ("ata", "havuz", "demo sil", "tv"…); eşleşme yoksa AI Asistan (`/app/asistan?q=`).
- Altında yalnız "Bugün" (Dikkat/Sıradaki eylem ≤5) + rol bazlı 3-4 büyük kısayol. Sahip için kapsam varsayılanı "Ofis geneli". KPI/gelir/ekip/huni "Ofis özeti" arkasına.
- Yeni menü (yollar sabit):
  - Sahip (6): Bugün · Müşteriler · İlanlar (Portföyler, **Havuz ve Atama**, İlan Kontrol, Portal ilanları, Anahtar, Sunumlar…) · Satış ve Para (Anlaşmalar, Teklifler, Sözleşmeler, Komisyon, Kazanç, Onaylar, Finans, Kiralama) · Ekibim (Danışmanlar, Hedefler, Takım/Şube, Devir, Ekip karnesi, TV modu, Ofis Kontrol) · Raporlar. Alt sabit: Ayarlar, Abonelik, Yardım, Menüyü düzenle. Araçlar (Değerleme, Hesaplayıcı, AI Asistan…) palet + "Araçlar" kartı.
  - Danışman (5): Bugün · Müşteriler · İlanlar · Satış (Anlaşmalar, Teklifler, Komisyonum, Kazanç) · Ben (Performansım, Hedefim, Profilim).
  - Muhasebe (4): Bugün · Para · Raporlar · Abonelik. Çağrı (4): Bugün · Gelen kutusu · Müşteriler · Randevu ve Görev.
- Mobil alt çubuk rol bazlı, ≤5: Sahip Bugün | Müşteriler | + Yeni | İlanlar | Menü; Danışman Bugün | Müşteriler | + Yeni | İlanlar | Ben.

## 6. Öncelikli uygulama listesi
1. Havuz görünür: "İlanlar > Havuz ve Atama", ana ekranda "Atanmamış ilan N" kartı, palette "havuz/ata".
2. Sahip kapsamı varsayılan ofis geneli; "Bugün" dönemi; "Bugün ofiste olanlar" kartı.
3. Hero'da "Ne yapmak istiyorsun?" kutusu + rol bazlı kısayollar.
4. Menü 6/5/4 satır (NAV_SECTIONS, nav-roles NAV_BUDGET/NAV_CORE_BY_ROLE, nav-budget-contract, app-sidebar).
5. Mobil alt çubuk rol bazlı + "+ Yeni" eylem sayfası.
6. Ekip Merkezi + Ofis Merkezi → "Ekibim"; listeye Uzmanlık/Bölge sütunu; Atamalar sekmesi kalkar.
7. Demo veriye örnek danışman + uzmanlık + bölge + bekleyen havuz ilanı; demo/kurulumda havuz açık.
8. Gelen ilan havuza: portal/ağ/API/eklenti kaynaklarında `enqueueListingPool`; havuz anahtarı kurulum sihirbazında.
9. TV modu etiketli düğme + Ekibim sekmesi + palette "tv" → /app/pano-tv.
10. Tek "Kurulum" akışı; tur `data-tour="ilan-havuzu"` havuz sayfasına.
11. "Ayarlar" adlı sekmeler gerçek adlarla.
12. İlan Havuzu sayfası sadeleştirme + jargon.
13. Danışman formu 3 adım.
14. Danışman "Komisyonum" Satış satırında.
15. Performans yüzeyleri birleştirme (uzun vadeli).
