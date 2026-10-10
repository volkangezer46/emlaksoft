# UX Ekran Denetimi - Ekim 2026

Kapsam: /app’in sık kullanılan ekranları (ana ekran, müşteriler + detay, portföyler + detay, talepler, randevular,
anlaşmalar + detay, kiralama + Aidat & site, giderler, raporlar, ekip + danışman detayı, ilan havuzu, ilan kontrol,
ayarlar, hesabım, TV panosu). Yöntem: canlı demo oturumu (sahip@demo), Playwright; 1440 / 390 / 360 açık, 390 koyu;
otomatik ölçüm (yatay taşma, 44 px altı hedef, sekme sayısı) + ekran görüntüsü + kaynak okuma.
Ekran görüntüleri yalnız geçici klasörde tutuldu. Kod değiştirilmedi. Danışman rolü (danisman@demo) taranmadı.

## Genel ölçüm özeti
- 360/390 px’te HİÇBİR sayfada belge düzeyinde yatay kaydırma yok (scrollWidth = görünüm genişliği). Güçlü yan.
- Müşteri listesi mobilde kart satırına dönüyor (iyi). Anlaşma tahtası yatay kaydırmalı kanban (kasıtlı).
- Koyu tema (390) ana ekran / anlaşmalar / müşteriler’de okunaklı; belirgin kontrast bozulması görmedim.
- Ortak sorun: üst çubuk düğmeleri ve alt menü sekmeleri 38-41 px (44 px altı); sekme şeritleri 2-3 kat üst üste.

## Kritik

### K1 - Randevular: ikincil düğme açık temada görünmez
- Dosya: src/app/app/randevular/export-ics-button.tsx:77 (kullanım: randevular/page.tsx:686)
- Düğme `text-white border-white/15 bg-white/5` (koyu zemin için yazılmış) ama açık renkli sayfa başlığında duruyor:
  1440 ve 390’da "Takvime aktar (.ics)" beyaz üstüne beyaz, okunmuyor. ".ics" basit kullanıcı için jargon.
- Ayrıca CLAUDE.md "dışa aktarma = Rapor merkezi" kuralına aykırı (sayfada indirme düğmesi).
- Öneri: düğmeyi sayfadan kaldır; "Raporlarda aç" (ReportOpenLink) veya "Takvimime ekle" adıyla tek bağlantı yap.
  Kalacaksa kanonik `Button variant="secondary"` kullan.

### K2 - Sekme şeritleri 2-3 kat üst üste, mobilde yalnız ikon (ne olduğu anlaşılmıyor)
- Dosya: src/components/app/section-tabs.tsx:66-97 (grup şeridi + alt sekme şeridi),
  src/components/ui/morph-tab-parts.tsx:162 (etkin olmayan sekme etiketsiz: inactive icon), sekme sınırı `MAX_VISIBLE_TABS` (src/lib/morph-tabs).
- Ölçülen: Portföyler 5+5 ikon (üstte Portföy/İlan Kontrol/Kiralama/Projeler/Ofis Ağı, altta Portföyler/Anahtar/Sunumlar/
  İlan Havuzu/Ayarlar); Ekip 5+5; Ayarlar 5+5+5 çip (3 kat); Raporlar 3+8 (sağ uç kesik); Aidat & site 5+3+3;
  Anlaşma detayı 2+2+6 (sağ uç kesik). Mobilde ilk ekranın yaklaşık dörtte biri gezintiye gidiyor, etkin olmayanlar sadece ikon.
- Öneri: mobilde TEK şerit (yalnız sayfa içi sekmeler), üst grup şeridi alt menü "Daha fazla" çekmecesine; etiket
  mobilde de görünsün (kısa) ya da "Bölüm" açılır seçici; sekme sayısı en fazla 4 (+ "Diğer").

### K3 - TV panosu mobilde okunmaz
- Dosya: src/app/app/pano-tv/tv.css:136-144 (container sorgusu max-aspect-ratio 1/1 ile 2 sütun, yine tüm kartlar),
  yazı boyutları `calc(var(--u) * 1.1 ...)` ölçeği.
- 390x844’te tüm kartlar küçülüp çok küçük yazıya iniyor; sayılar okunmuyor.
- Öneri: dikey ekranda tek sütun + `font-size: max(12px, ...)`, kart sayısını 3-4’e düşür veya telefonda
  "TV modu büyük ekran içindir" notu + sade özet. Üst çubuktaki TV simgesi mobilde gizlenebilir.

### K4 - Müşteri detayı: 8 sekmeli şerit + açıklamasız skor
- Dosya: src/app/app/musteriler/[id]/customer-360-tabs.tsx:218-225 (Zaman çizelgesi, Talepler ve eşleşmeler,
  Teklifler ve anlaşmalar, Randevu ve görevler, Belgeler ve imza, İletişim tercihleri, İletişim kayıtları, Notlar).
- 390’da ikon + yatay kaydırma; "İletişim tercihleri" ile "İletişim kayıtları" adları birbirine çok yakın. Üst başlıkta
  "Soğuk · 44" ve "Müşteri skoru 44" ne anlama geldiği açıklanmadan duruyor; isim yanında boş beyaz daire görüldü
  (kaynağı doğrulanmadı).
- Öneri: 4 sekme (Genel / Talepler / Anlaşmalar / Dosya ve notlar), kalanı alt bölüm; "Soğuk" yerine
  "Uzun süredir görüşülmedi" gibi eylemli etiket; ilk ekranda tek birincil düğme "Ara", diğerleri "Daha fazla".

## Yüksek

### Y1 - Üst çubuk ve alt menü dokunma hedefleri 44 px altı
- Dosyalar: src/components/theme-toggle.tsx:23 (`h-10 w-10`), src/components/app/quick-create-menu.tsx:29 (`h-10`),
  src/components/app/notification-bell.tsx:27 (`h-10 w-10`), src/components/app/command-search.tsx:33 (`h-10 w-10` mobil).
  Ölçüm 390’da: Ara 38x38, Tema 38x38, Yeni 38x38, Bildirim 38x38; alt gezinme sekmeleri 58x41 / 122x41.
  (Menü düğmesi app-sidebar.tsx:427 `h-11 w-11`, doğru.)
- Öneri: mobilde `h-11 w-11` (en az 44); alt sekme çubuğunda satır `min-h-11` ve en az 56 px yükseklik.

### Y2 - Ana ekran ilk bakışta karmaşık; tur kutusu içeriğin üstüne biniyor
- Dosya: src/app/app/page.tsx (419 satır), src/app/app/dashboard-widgets.tsx, src/app/app/product-tour.tsx.
- 1440: karşılama + 7/30/90 gün + "Ofis geneli / Benim işlerim" + Müşteri/Düzenle düğmeleri + "Başlangıç" kartı (%9, %75,
  6/8: üç farklı ilerleme sayısı) + 5 KPI + Dikkat gerekenler. Üst çubukta "Skor 76", sol altta "%33 Profesyonel": anlamı
  açıklanmayan sayılar. 390: "Ofis sahibi turu" kutusu alt menünün hemen üstünde, sayfa kaydırılmış halde açılıyor.
- Öneri: tek birincil eylem ("Bugün yapılacaklar" + tek "Yeni müşteri"); ilerlemeleri tek "Kurulum %75" kartında birleştir;
  turu bir kez ve sayfa başında aç; "Skor 76" ne olduğunu açıkla ya da kaldır.

### Y3 - Ayarlar (3 katlı sekme) ve İlan Kontrol (2 katlı + 5 sekme + 2 düğme)
- Ayarlar: src/app/app/ayarlar/page.tsx + `_sekmeler`: bölüm şeridi 5, alt şerit 5, çip sekmeler (Marka ve kimlik /
  Eşleştirme / Entegrasyonlar / Bildirimler / Tüm ayarlar, 390’da 2 satıra kırılıyor), hemen ardından kırmızı uyarı
  ("Yetki belgesi no girilmemiş"). Sayfa başlığı "Demo Emlak Ofisi"; "Ayarlar" kelimesi başlıkta yok.
- İlan Kontrol: "İlan Kontrol Merkezi" altında 2 düğme (Uyarı kuyruğu / Portal listesiyle karşılaştır) + 5 sekme
  (Özet/Liste/Uyarılar/Portal listesi/Eşleşme) + kurulum sihirbazı. Jargon: "Eklentiyi indir", chrome://extensions,
  "Geliştirici modu", "Paketlenmemiş öğe" (src/components/listing-control/sync-setup.tsx:133, extension-wizard.tsx:165).
- Öneri: Ayarlar tek liste ("Ofis bilgileri, Ekip, Bildirimler" kartları); İlan Kontrol’de tek birincil eylem,
  kurulum adımları yalnız eklenti yoksa ve "Kurulum yardımı" arkasında; Chrome yönergesi kısa video/ekran görüntüsüyle.

### Y4 - Mobilde sayfa başlığı bloğu ekranın yarısını kaplıyor (hero + 4-6 KPI kartı)
- Dosya: src/components/ui/page-header.tsx, src/components/ui/dashboard-hero.tsx; kullanan: musteriler/page.tsx,
  portfoyler/page.tsx, talepler/page.tsx, randevular/page.tsx, giderler/page.tsx.
- 390’da liste (asıl iş) ilk iki ekrandan sonra başlıyor; KPI kartları 2 sütunda 3-4 satır. Talepler’de "Acil/yüksek 0",
  "30+ gündür açık 0"; Randevular’da 4 sıfır KPI soluk kart olarak yer kaplıyor.
- Öneri: mobilde KPI’ları tek satır yatay kaydırmalı şeride indir; sıfır kartları gizle; liste hero’nun hemen altında.

### Y5 - Jargon: "Pipeline", "SLA", "hat", "ağırlıklı tahmin", "EİDS", "motor"
- src/app/app/anlasmalar/[id]/page.tsx:377 "Pipeline’a dön"; anlasmalar/page.tsx "Anlaşma hattı / Açık hat / Ağırlıklı tahmin";
  portfoyler/page.tsx süzgeç çipleri "Foto eksik", "EİDS no eksik", "Yabancıya satış"; ilan havuzu "SLA’sı geçen";
  raporlar "Aday hızı" (lead-hizi); talepler "Eşleştirme motoru".
- Öneri: Pipeline -> "Anlaşma listesi"; hat -> "açık anlaşmalar"; ağırlıklı tahmin -> "beklenen gelir"; SLA -> "süresi geçen";
  EİDS -> "Yetki belgesi no"; motor -> "Uygun portföyleri bul". Her kısaltmada `HelpTip`.

## Orta

### O1 - Raporlar: KPI başlığı kesiliyor, iki giriş noktası
- src/app/app/raporlar/page.tsx:326 `label="Kaçan komisyon (tahmini)"` (22 karakter üstü); 390’da "Kaçan komisyon..." diye kesiliyor.
- İlk ekranda "Rapor merkezi" kartı + "Ofis sağlık & performans" + skor: iki büyük başlık, iki yol. Sekme şeridi 3 + 8.
- Öneri: etiket "Kaçan komisyon" + `title`; Rapor merkezi tek bağlantı satırına insin; 8 alt rapor "Tüm raporlar" açılırına.

### O2 - Ekip: düğme yoğunluğu, tekrarlı davet kartı
- src/app/app/ekip/page.tsx: 3 ikincil düğme (İzin matrisi, Tatil ve izin takvimi, Kartvizitim) + "Danışman ekle"; altında "Ekibiniz
  büyüyor" davet kartı (ikinci mavi düğme). Başlık "Çalışan yönetimi" ile menüdeki "Ekip Merkezi" adı tutarsız.
  Danışman detayında başlık yalnız rol ("Danışman"), isim değil (demo verisi olabilir, doğrulanmadı).
- Öneri: sayfa başına tek mavi düğme; davet kartı kapatılabilir ve bir kez; ad tutarlılığı "Ekip".

### O3 - Kiralama: iki "Kapalı" ayar kartı ana işin önünde; Aidat & site 3 kat sekme
- src/app/app/kiralama/page.tsx: "Gecikme bedeli (Kapalı)" ve "Kiracı hatırlatma (Kapalı)" uzun açıklamalı iki kart KPI’lardan önce.
- Aidat & site (src/app/app/aidat): üç kat (grup / alt / sayfa sekmeleri Genel, Binalar, Hukuk - ikon); açıklamadaki
  "Binalar sekmesinde" göndermesi mobilde sekme etiketi görünmediği için anlaşılmıyor (K2).
- Öneri: kapalı ayarlar "Ayarlar" bağlantısına taşınsın; ilk ekranda aktif kira / tahsilat / geciken.

### O4 - Anlaşma tahtası ve detay
- src/app/app/anlasmalar/page.tsx (tahta, yaklaşık satır 403-650): mobilde yatay kanban; kartta 5-6 küçük düğme (Geçiş, Düzenle,
  Portföy, Müşteri, Nitelikli, Kayıp) iç içe, yaklaşık 28-32 px. Detayda aşama çipleri + 4 KPI koyu blokta, 6 sekme sağda kesik.
- Öneri: mobilde kartta tek "Aç"; aşama değiştirme alt çekmecede; kartta en az 44 px dokunma.

### O5 - Giderler: ham tarih alanları, başlık adı
- src/app/app/giderler/page.tsx: üst şerit 2 sekme; başlık "Masraf & Giderler", menüde "Giderler". Tarih filtresi
  gg.aa.yyyy yerel girişleri + "Filtrele" mobilde sıkışık. Birincil düğme tek ("Yeni gider"): iyi.
- Öneri: hızlı çipler yeterli; özel tarih "Özel aralık" açılırına.

### O6 - Portföy detayı: yetki belgesi uyarısı ilanın önünde
- src/app/app/portfoyler/[id]/page.tsx: kırmızı "Yetki belgesi no girilmemiş" kutusu her portföyde ilan başlığından önce;
  başlık bloğunda birincil düğme belirsiz (Portal bağla / Randevular / Daha fazla eşit ağırlıkta); fiyat altında dolar ve avro karşılığı satırı.
- Öneri: uyarıyı kapatılabilir yap ve başlığın altına al; birincil "Müşteriye gönder" (paylaş).

### O7 - Talepler: iki ad aynı işe
- src/app/app/talepler/page.tsx:1-52 `PageTabs` ("Talepler / Eşleşme") + hero’da "Eşleştirme motoru" düğmesi.
- Öneri: tek ad "Uygun portföyleri bul".

## Düşük
- D1 Bildirim rozeti "9+" ve alt menü "Daha fazla" rozeti "3": ekranda iki farklı sayı; üst çubukta rozet düğme dışına taşıyor (390).
- D2 Koyu temada üst çubuk avatarı sönük, ince çerçeve kontrastı düşük (görsel; WCAG ölçülmedi, doğrulanmadı).
- D3 Hesabım: 5 sekmeli şerit ikon-yalnız; avatar seçici ilk ekranı kaplıyor, "Parola ve oturum" daha altta.
- D4 İlan havuzu: "Kapalı" rozetli sayfa 5 sıfır KPI ile açılıyor; "Havuzu aç" asıl eylemi ayar formunda aşağıda (boş durum eylemi eksik).
- D5 Müşteri listesi satırı: eylem düğmeleri yaklaşık 40 px; "Soğuk 44" rozeti ve "Temas yok" açıklamasız.
- D6 Menü adları: "Ayarlar" sekmesi 4 yerde (Müşteriler / Portföyler / Sözleşmeler / Kampanyalar, nav-config.ts) farklı anlamda;
  alt menüde "Daha fazla", yan menüde "Diğer" iki ayrı ad.
- D7 Bu denetimde danışman rolü ve 320 px altı ekranlar taranmadı.

## Tüm sisteme uygulanacak 10 tasarım kuralı
1. Sayfa başına TEK birincil (dolu mavi) düğme; geri kalanı ikincil/çerçeveli, mobilde "Daha fazla" menüsünde.
2. Mobilde en çok TEK sekme şeridi (grup şeridi alt menü/çekmeceye); sekme etiketi her zaman görünür, ikon tek başına olmaz.
3. Bir şeritte en çok 4 sekme (+ "Diğer"); 8 sekmeli ekranlar bölüm başlığıyla ikiye ayrılır.
4. Mobilde tablo yerine kart; satır eylemi tek "Aç", ikincil eylemler üç nokta menüsünde.
5. Dokunma hedefi en az 44x44 (üst çubuk, alt menü, satır eylemi, sekme): mobilde `h-10` yerine `h-11`.
6. İlk ekranda (390x844) liste/asıl iş görünür: hero en çok 160 px, KPI en çok tek satır (yatay kaydırmalı), sıfır KPI gizlenir.
7. Sabit alt eylem çubuğu: form ve detay sayfalarında ana eylem (Kaydet / Ara / Yeni) mobilde alt menünün üstünde yapışık.
8. Jargon yasak listesi: pipeline, lead, SLA, EİDS, ics, motor, hat, ağırlıklı; yerine günlük Türkçe + `HelpTip`.
9. Boş durum = tek cümle neden + tek düğme; "Kapalı" ayarlar sayfa başında yer kaplamaz, "Ayarlar" bağlantısı olur.
10. Renk tek kaynak: beyaz yazı yalnız koyu zeminde (`.theme-dark`); sayfada ham `text-white`/`border-white/*` yok, kanonik `Button`
    kullanılır; açık + koyu tema birlikte denenir; sayfada dosya indirme düğmesi yok (Rapor merkezi).
