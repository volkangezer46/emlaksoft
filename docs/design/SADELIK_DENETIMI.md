# Sadelik Denetimi: "En basit kullanıcı da rahat kullanabilsin"

Tarih: 3 Ekim 2026. Rol: kullanılabilirlik uzmanı. Hedef kişi: bilgisayar/yazılım deneyimi az, 50+ yaşında bir emlakçı (telefonu WhatsApp ve aramayla kullanır, "sekme", "filtre", "KPI", "lig" kelimelerini bilmez).

Yöntem: kod incelemesi (`src/lib/nav-config.ts`, `permissions.ts`, `onboarding-checklist.ts`, `product-tour.tsx`, `_home/*`, form sekme tanımları, sayfa başlıkları) + canlı salt-okunur Playwright (https://emlaksoft.vercel.app, 1440 ve 390 genişlik, "Ofis sahibi" ve "Danışman" demo kartları; hiçbir Kaydet/Sil basılmadı, veri yazılmadı). Kod değiştirilmedi. Betikler ve ekran görüntüleri scratchpad `sd/` klasöründedir.

## 0. Ölçülen gerçekler

| Ölçüm | Değer |
|---|---|
| /app altında page.tsx | 109 (detay/yeni/alt sayfalar dahil) |
| Menü başlığı / menü öğesi / sekmeyle erişilen ek sayfa | 9 / 46 / +8 (Kiralama 2, Komisyon 3, Ekip performansı 2, Ekip Merkezi 5) = **54 giriş noktası** |
| Ofis sahibine görünen yan menü bağlantısı | 47 (+ "Son kullanılanlar", "Sabitlenenler" tekrarları) |
| **Danışmana** görünen yan menü bağlantısı | **43** (Otomasyonlar, İş Akışları, Belge Merkezi, Denetim, Uyum, Ayarlar, Ekip Merkezi dahil; çünkü `advisor.settings = VIEW`) |
| Ana ekran (/app) kutu/blok sayısı | 13 başlık, ~18 blok; masaüstü kaydırma 3.518 px, **mobil 6.748 px** |
| Ana ekranda yazı boyutu dağılımı (karakter) | 12 px: 1225, 13 px: 189, 14 px: 1126, 16 px: 99 (yani metnin ~%75'i 12-14 px) |
| Dokunma hedefi < 44 px (görünür etkileşimli öğe) | masaüstü 156/202, mobil 48/100. Menü satırı 40 px, "7/30/90 gün" 32 px, "Bölümü daralt" 32 px, sabitle ikonları 28 px |
| Yeni müşteri formu | 5 sekme, 1 zorunlu alan, 3 sütun (sekme listesi + alan + "Özet ve önizleme") |
| Yeni portföy formu | 5 sekme, 3 zorunlu alan (başlık, işlem/tür, fiyat, komisyon %) |
| "Yeni" (+) menüsü | ~14 eylem, 3 grup + "Diğer" |
| Yazı boyutu / yakınlaştırma ayarı | yok (`text-xs` 2.300 yerde) |
| Yardım merkezi / bağlam içi "?" ipucu | yok (Destek = fatura/teknik talep formu) |

Genel teşhis: ürün güçlü ama **"uzman paneli"** gibi davranıyor. Her şey ilk günden görünür, terimler iç mühendislik/pazarlama diliyle yazılmış, yardım yok. Sade kullanıcı için sorun özellik azlığı değil; **seçenek fazlalığı ve belirsiz kelimeler**.

---

## 1. İlk giriş ve onboarding (ilk 5 dakika)

**1.1 Ürün turu 5 adımda 4 jargon taşıyor ve mobilde hiç çalışmıyor. [P1, S, `product-tour.tsx`]**
Görülen: giriş sonrası 0,8 sn'de karartılmış ekran, "Adım 1/5 Günaydın brifingi", sonra "Canlı KPI kartları", "Komut paleti", "Modüller". Mobilde (`innerWidth < 768`) tur hiç başlamıyor; telefonda kullanan emlakçı turu hiç görmüyor. Tur bir kez gösteriliyor (`localStorage`), sonradan yeniden başlatma yolu yok. Tur yalnız "nerede ne var" anlatıyor, "ne yapmalıyım" demiyor.
Kim zorlanır: yaşlı kullanıcı, "KPI/komut paleti" kelimelerini bilmez; geçince bir daha bulamaz.
Çözüm: turu 3 adıma indir ("Bugün yapılacaklar", "Yeni kayıt ekle (+)", "Arama"), dil: "Rakamlar", "Hızlı arama". Yan menüde/yardım menüsünde "Turu yeniden göster". Mobil için kısa alt-sayfa turu.

**1.2 Kurulum sihirbazı altı adım ama ikisi sade kullanıcıyı durdurur. [P1, S, `onboarding-checklist.ts`]**
Görülen: adımlar "profil, ilk müşteri, ilk portföy, ilk anlaşma, ekip, WhatsApp/SMS bağla". "İlk müşterinizi ekleyin" düğmesi liste sayfasına (`/app/musteriler`) gidiyor, forma değil (bir tık fazla); "Müşteri ekle" etiketi ise forma gidecek gibi. Dilde tutarsızlık: "İlk **anlaşmanı** kapat" (sen) ve diğerleri "ekleyin" (siz). "WhatsApp veya SMS bağlayın" teknik entegrasyon, yalnız ofis sahibi için; danışmana gösterilmemeli. "Ofis kurulumu" menüde sürekli duruyor, bitince de.
Çözüm: CTA'ları doğrudan `/yeni` formlarına bağla; tüm metni "siz" diline çevir; kurulum tamamlanınca menüden "Ofis kurulumu" öğesini gizle (Ayarlar içine taşı); rol bazlı adım listesi (danışman: ilk müşteri, ilk portföy, ilk randevu).

**1.3 Ana ekranda iki kurulum bileşeni yarışıyor. [P2, S, `_home/baslayalim.tsx`, `page.tsx`]**
Görülen: kurulum şeridi ("Kurulum %67 · 4/6 adım · Sıradaki: Ofis profilini tamamlayın"), duyuru satırı ve "Bugün kuyruğu" hepsi aynı ekranın ilk fold'unda. Boş ofiste güzel bir "Başlayalım" kartı var (iyi), ama dolu ofiste kurulum şeridi küçük yazı (12 px) ve soluk.
Çözüm: tek "sıradaki en iyi eylem" kartı (bkz. bölüm 11); kurulum adımı o kartın içinden çıksın.

**1.4 Boş durumlar iyi ama yönlendirme tek tip değil. [P3, M]**
Görülen: `EmptyState` bileşenleri var, "Bugün için acil iş yok", "Bu hafta yeni talep açılmadı" gibi dürüst metinler güzel; ancak bazıları ("Üyeler şu an okunamadı") çözüm sunmuyor. Her boş durumda tek birincil düğme ("Müşteri ekle", "İlk portföyünü ekle") ve 1 cümlelik "bu ne işe yarar" olmalı.

---

## 2. Menü: sayfa sayısı ve jargon

**2.1 54 giriş noktası aynı anda görünür; sade kullanıcı için "çok fazla". [P0, L, `nav-config.ts`, `app-sidebar.tsx`, `layout.tsx`]**
Görülen: 9 başlık makul, ama her başlık açılınca 3-9 öğe; "Portföy" 8, "Ofis" 9, "Performans" 6 öğe. Yan menü yaklaşık 47 satır; üstte "Son kullanılanlar" ve "Bugün" bölümünde "Ana ekran" iki kez. Danışman da 43 satır görüyor.
Kim zorlanır: herkes; 50+ kullanıcı "nereye bakacağım" diye bırakır.
Çözüm: **Sade görünüm** (bölüm 10): varsayılan 12 sayfa, gerisi "Daha fazla". Danışman için `settings` kaynaklı öğeleri (Otomasyonlar, İş Akışları, Denetim, Belge Merkezi, Uyum) menüden çıkar.

**2.2 Menüde "Ana ekran" iki kez + "Son kullanılanlar" + "Sabitlenenler" aynı öğeyi tekrar ediyor. [P2, S, `app-sidebar.tsx`]**
Görülen (1440): yan menüde "SON KULLANILANLAR: Ana ekran" ve hemen altında "BUGÜN: Ana ekran". Üstte hem yan menüde "Ara… ⌘K" hem üst çubukta ayrı bir arama kutusu var (iki arama).
Çözüm: son kullanılanlar yalnız başlık dışı sayfaları göstersin; tek arama kutusu.

**2.3 Jargon sözlüğü: menü ve sayfa başlıkları. [P1, S-M, `nav-config.ts` + sayfa `PageHeader`'ları]**

| Şimdi | Sorun | Sade alternatif |
|---|---|---|
| Eşleştirme / "Akıllı eşleşme motoru" / "Talep × Portföy" | "motor", "×" ; menüde başka, sayfada başka ad | **Müşteriye uygun ilanlar** |
| Akıllı Listeler / "Davranışsal segmentler" / "churn, niyet" | segment, churn | **Kimi aramalıyım?** |
| Tavsiyeler | referans mı yoksa öneri mi belirsiz | **Müşteri tavsiye linki** |
| Kayıp-kaçak / "Leak Shield" / "Kaçan komisyon motoru" | üç farklı ad, İngilizce | **Kaçırdığım komisyonlar** |
| Kayıp Satış / "Risk Altındaki Müşteriler" / "dedektör" | üç ad | **Unuttuğum müşteriler** |
| Ekip Ligi / Lig Tablosu | spor jargonu, yarış baskısı | **Ekip sıralaması** (isteğe bağlı) |
| Danışman KPI / Ekip performansı | KPI | **Danışman sonuçları** |
| Otomasyonlar / "Tetikleyici → koşul → aksiyon" | mühendis dili | **Otomatik işler** ("... olunca ... yap") |
| İş Akışları / "iş akışı şablonları" | Otomasyonlardan farkı anlaşılmıyor | **Hazır görev listeleri** |
| Portal Kontrol | portal = ilan sitesi mi? | **İlan sitelerim (Sahibinden, Hepsiemlak)** |
| Anahtar Takibi / Sunumlar | Sunum = ? | **Anahtar defteri / Müşteriye sunum dosyaları** |
| Ofisler Arası Ağ | | **Ortak ofis ağı** |
| Uyum / Uyum merkezi / "İYS" | hukuk dili | **Yasal izinler (SMS/arama izni, yetki belgesi)** |
| Denetim / "immutable günlük / logActivity" | geliştirici metni kullanıcıya görünüyor | **Kim ne yaptı?** (açıklamadan `logActivity` ve "immutable" silinsin) |
| Ofis Panosu (TV) | | **Ofis ekranı (TV)** |
| Değerleme / "Endeksa, Tapusor EDİ, emsal m²" | marka+jargon | **Fiyat tahmini** |
| Hesaplayıcılar | | tamam (alt başlık: "Kâr/Getiri hesabı") |
| Kampanyalar | toplu mesaj mı reklam mı | **Toplu mesaj** |
| Gelen Kutusu / Akıllı Arama | "Akıllı Arama" arama kutusu sanılır (üstteki aramayla karışır) | **Arama kayıtları (görüşme defteri)** |
| "Kurulum", "Başlangıç" | iki ad aynı sayfa | **Ofis kurulumu** (tek ad) |
| Ofis skoru 56 · Orta (üst çubuk) | kural tabanlı ama "skor" ne için? | **Ofis durumu: İyi / Orta / Dikkat** + tıklayınca neden |
| "Bugün kuyruğu" | kuyruk teknik | **Bugün yapılacaklar** |
| "Playbook", "pipeline", "heatmap" | 13+ yerde "playbook", 3 yerde "Pipeline" | **Adım adım yol / Satış aşamaları** |
| Ekran metni: "Scraping yok — kendi veriniz" | geliştirici cümlesi | silinsin |
| "SLA", "teyit" | | **Süre sınırı / İlan kontrolü** |

Koddan ölçülen: UI metinlerinde "KPI" 13, "playbook" 13, "churn" 9, "token" 23, "widget" 16 geçiş; sade metne çevrilebilir bir sözlük dosyası (`src/lib/ui-terms.ts`) ile tek yerden yönetilmeli.

**2.4 Ekip Merkezi sekmeleri ve Finans/Performans yinelemesi. [P2, M]**
Görülen: "Ekip Merkezi" menüde, ama sayfa başlığı "Çalışan yönetimi"; 5 sekme (Genel, Kıyas, Kazanç, Hedefler, Devir/Atama) + üstte "İzin matrisi, İzin takvimi, Kartvizitim, Ekip üyesi ekle" düğmeleri. "Kıyas" ile "Ekip performansı > Danışman KPI/Ekip Ligi" ve "Kazanç" ile "Komisyon > Cüzdanım" üst üste biniyor.
Çözüm: Sade kullanıcıya yalnız "Genel" (ekibim) + "Hedefler"; diğer sekmeler "Daha fazla".

---

## 3. Formlar

**3.1 "Yeni müşteri" 5 sekme, ilk bakışta 3 sütunlu; hızlı ekle yok. [P0, M, `musteriler/yeni/customer-form.tsx`, `customer-tabs.ts`]**
Görülen: tek zorunlu alan "Ad soyad", ama ekranda sol sekme listesi + orta form + sağda "Özet ve önizleme" (Kayıt bilgisi, Talep kaydı, Talep: İşlem Satılık, Tür Daire) var. Sade kullanıcı "ne doldurmalıyım?" diye 5 sekmeyi gezer. Sekme "Talep ve kriterler" boş olduğu halde **yeşil "Tamamlandı" tikini** gösteriyor (zorunlu alan yok diye); yanıltıcı.
Çözüm: "Hızlı ekle" tek adımlı (Ad, Telefon, Alıcı/Satıcı/Kiracı; üç alan, tek Kaydet) varsayılan; altında "Daha fazla bilgi ekle" ile mevcut tam form. İsteğe bağlı sekmelerde tik yerine "isteğe bağlı" rozeti. Sağ özet panelini varsayılan kapalı yap.

**3.2 "Yeni portföy" 5 sekme + 3 zorunlu alan sekmelere dağılmış. [P1, M, `portfoyler/yeni/property-form.tsx`, `property-tabs.ts`]**
Görülen: "Temel" (başlık+işlem+tür), "Fiyat ve komisyon" (fiyat+komisyon %) farklı sekmelerde; zorunlu alanlar 1. ve 3. sekmede, kullanıcı 3. sekmeyi hiç açmazsa Kaydet'te hata alır. Sağ panel "1 zorunlu alan eksik" dese de sekme dışında kalan alan gizli kalır.
Çözüm: "Hızlı ekle": Başlık, Satılık/Kiralık, Tür, Fiyat, (komisyon varsayılanı ofis ayarından, ör. %3), tek sayfa. Gerisi "Fotoğraf, konum, özellikler ekle".

**3.3 Sekmeli formda "kaybolma" riski. [P1, S-M, `tabbed-form-shell.tsx`]**
Görülen: sekme başlıkları "Kişi / İletişim ve bölge / Talep ve kriterler / Özel günler / Not"; her sekmenin altında 2 satır açıklama (14 px). "Sonraki: İletişim ve bölge" düğmesi iyi. Eksik zorunlu alan için hata mesajı tek sekmede kaldığında diğer sekmedeyken görünmeyebilir. Klavye kısayol ipucu ("Ctrl+Enter ile kaydet · Alt+↑↓ sekme") 12 px, sade kullanıcı için anlamsız.
Çözüm: Kaydet'e basıldığında ilk hatalı sekmeye otomatik geç ve alanı vurgula; "Ad soyad yazmanız gerekiyor." gibi alanın yanında kırmızı cümle; klavye ipucunu yalnız masaüstü ve "gelişmiş" modda göster.

**3.4 Hata mesajları kısa ama eyleme yönlendirmiyor. [P2, S, `app/actions/*.ts`]**
Görülen: "Ad soyad zorunlu.", "Müşteri güncellenemedi.", "Danışman ataması yapılamadı." Neden ve ne yapılacağı yok.
Çözüm: "Ad soyad boş bırakılamaz; lütfen müşterinin adını yazın." / "Kaydedilemedi. İnternetinizi kontrol edip tekrar deneyin; sorun sürerse Destek'e yazın." Ortak sözlük: gerekçe + sonraki adım.

**3.5 İki ayrı "ekle" mantığı: üst "+ Yeni" menüsü (~14 eylem) ve sayfaya özgü "Yeni ..." düğmesi, ana ekranda "Müşteri" altın düğmesi. [P2, S, `quick-create-menu-body.tsx`, `_home/hero.tsx`]**
Görülen: mobilde üst "+" ikon (etiket "Yeni" gizli, `hidden sm:inline`); ana ekranda "+ Müşteri" düğmesi ne yaptığı belirsiz (ekle mi, liste mi). "Düzenle" düğmesi neyi düzenlediğini söylemiyor (bileşenleri).
Çözüm: "+ Yeni" menüsünü sade modda 5 öğeye indir (Müşteri, Portföy, Randevu, Görev, Not/Arama); düğme etiketleri "Müşteri ekle", "Ana ekranı düzenle".

---

## 4. Rol bazlı sade mod

Mevcut: `visibleSections(accessible)` modül iznine göre süzüyor (iyi temel), ama roller yetkiye göre değil **işe göre** sadeleşmiyor. `advisor.settings = VIEW` yüzünden danışman Ayarlar, Otomasyonlar, İş Akışları, Belge, Denetim görüyor (43 öğe, ofis sahibinden yalnız 4 eksik).

**4.1 Rol varsayılanı ile "menü profili" ayrılmalı. [P0, M, `nav-config.ts`, `permissions.ts`, `app-sidebar.tsx`]**
`NavItem`'a `tier: "core" | "more"` ve `roles?: AppRole[]` (öne çıkacak roller) ekle; `visibleSections` yeni parametre `mode: "simple" | "full"`. İzin matrisine dokunulmaz (yetki ≠ görünürlük). Rol varsayılanları:

| Rol | Sade menüde (öncelik) | "Daha fazla"da |
|---|---|---|
| Ofis sahibi | Ana ekran, Müşteriler, Talepler, Portföyler, Anlaşmalar, Randevular, Görevler, Komisyon, Raporlar, Ekip Merkezi, Ayarlar, Destek | Geri kalan |
| Danışman | Ana ekran, Müşteriler, Talepler, Portföyler, Eşleştirme, Randevular, Görevler, Anlaşmalar, Gelen Kutusu, Değerleme, Komisyon (yalnız kendi), Destek | Otomasyon, İş Akışları, Belge, Denetim, Uyum, Ayarlar menüden çıkar |
| Muhasebe | Ana ekran, Komisyon, Anlaşmalar, Giderler, Aidat, Raporlar, Müşteriler (görüntü), Abonelik, Destek | Geri kalan |
| Sekreter / çağrı merkezi | Ana ekran, Müşteriler, Talepler, Randevular, Görevler, Gelen Kutusu, Arama kayıtları, Destek | (`call_center` zaten ~10 öğe) |

**4.2 Danışmanın menüsünden yönetim öğelerini çıkar. [P1, S, `nav-config.ts`]**
`settings` görüntüleme izni "ayar yapar" demek değildir; Otomasyonlar/İş Akışları/Belge/Denetim/Uyum için `module: "settings"` yerine yazma yetkisi gerektiren `requireAction`/`minRole` benzeri ölçüt (ya da `tier: "more"` + yalnız `owner|gm|branch_manager`).

---

## 5. Yardım

**5.1 Yardım merkezi yok; "Destek" bir bilet formu. [P0, M-L, yeni `/app/yardim`, `destek/*`]**
Görülen: menüde "Destek" yalnız "Talepleriniz · Yeni talep"; "Nasıl yapılır?" yok. Yaşlı kullanıcı takıldığında bilet açmaz, bırakır.
Çözüm: üst çubukta her sayfada sabit **"Yardım" (?)** düğmesi: (a) bu sayfa için 3 satır ipucu, (b) "Turu yeniden göster", (c) 10 kısa "Nasıl yapılır" kartı (müşteri ekle, ilan ekle, randevu ver, WhatsApp'tan yaz, komisyonu gör), (d) "Bizi arayın / WhatsApp'tan yazın". Sayfa başına tek yardım metni `PageHeader`'a `help` prop'u ile.

**5.2 Bağlam içi ipucu yok; teknik kısaltmalar açıklanmıyor. [P1, M, `components/ui/page-header.tsx`, `tooltip.tsx`]**
Görülen: "Ağırlıklar: Bütçe %27 · Konum %33...", "SLA içinde", "ort. skor", "Skor dağılımı 35–54 / 55–74"; tek tük `title=` ipucu (Ofis skoru için var, iyi örnek) ama tutarlı değil.
Çözüm: her terimin yanında "?" ikonu → tek cümle açıklama (ör. "Eşleşme puanı: müşterinin istediği ile ilanın ne kadar uyduğu, 100 üzerinden."). Mobilde dokununca alt sayfa.

**5.3 Arama (⌘K) keşfedilebilirliği: Windows kullanıcısına ⌘ simgesi. [P1, S, `app-sidebar.tsx`, `layout.tsx`, `command-search.tsx`]**
Görülen: yan menüde "Ara… ⌘K", üst çubukta "Müşteri, portföy, anlaşma, görev, ilan no ..." + "⌘ K". İki arama kutusu var; Windows'ta ⌘ anlamsız (`aria-label` "Ctrl K", ekranda ⌘). Metin "Ara…" ne arandığını söylemiyor. Hesap-makinesi özelliği ("%2 5.400.000") şık ama gizli.
Çözüm: tek, büyük arama kutusu: "Ad, telefon veya ilan no yazın"; platforma göre Ctrl/⌘; kısayol göstermeden varsayılan. Mobilde "Ara" etiketli düğme (şu an yalnız ikon).

**5.4 "Ne yapmalıyım?" önerileri dağınık. [P1, M, `_home/*`]**
Görülen: "Bugün kuyruğu" (3 madde), "Kayıp-kaçak", "Kurulum", "Günlük Brifing", "AI Asistan", Akıllı Listeler hepsi bir tür "ne yapayım" cevabı veriyor, ayrı ayrı. Bkz. bölüm 11: tek karta toplanmalı.

---

## 6. Hata, boş durum, yükleme dilleri

**6.1 Hata sayfası iyi (teknik mesaj sızmıyor) ama destek yolu yok. [P3, S, `app/app/error.tsx`]**
"Bu sayfa yüklenemedi / Tekrar dene / Panele dön" yeterince sade. Ekle: "Sorun sürerse bize yazın" (Yardım'a bağlantı) ve hata referans kodu (digest) küçük puntoyla.

**6.2 Rakam dili: "0", "%0", "₺0 B" kısaltmaları. [P2, S, `_home/komisyon-akisi.tsx`, `kpi-satiri.tsx`]**
Görülen: grafikte "₺398 B", "₺495 B" (B = bin) yaşlı kullanıcı milyar sanabilir; "Yeni talep ·..." ve "Bugün gele..." kırpılmış etiketler. Dolu ofiste çok "0 · %0 · Önceki 30 gün 0" satırı gürültü.
Çözüm: "398 bin ₺" ya da tam sayı; kırpılma yerine iki satır; sıfır olan kartı gizle veya "Henüz yok" yaz.

**6.3 Yükleme: iskelet kutuları iyi. [P3]** Yavaş sekme geçişlerinde (QA raporu: Devir/Atama 6,3 sn, Kıyas 3,3 sn) "Yükleniyor..." metni ve ilerleme göstergesi olmazsa kullanıcı tekrar tıklar. Sekme geçişinde üst ince ilerleme çubuğu önerilir.

---

## 7. Erişilebilirlik

**7.1 Metin çok küçük. [P0, M, `globals.css`, tüm `text-xs`]**
Ana ekran metninin ~%75'i 12-14 px (12 px: 1225 karakter, 14 px: 1126, 16 px yalnız 99). `text-xs` 2.300 yerde; form kısayol ipuçları, rozetler, etiket satırları 12 px. 50+ yaşında kullanıcı için asgari gövde 16 px, ikincil 14 px olmalı.
Çözüm: (a) yeni kök `font-size` ölçeği: "Yazı boyutu: Normal / Büyük / Çok büyük" ayarı (`html[data-font]`, `rem` tabanlı; kullanıcı menüsünde, mevcut tema seçiciyle yan yana); (b) `text-xs` alt sınırını 13 px'e çek; (c) "Sade görünüm" açıkken varsayılan "Büyük".

**7.2 Dokunma hedefleri 40 px ve altı. [P1, M]**
Ölçüm: menü satırı 40 px, üst çubuk düğmeleri 40 px, "7 gün / 30 gün / 90 gün" 32 px, "Müşteri / Düzenle / TV" 36 px, "Bölümü daralt" 32 px, sabitle ikonu 28 px; mobilde de aynı. Standart: en az 44×44 px (WCAG 2.5.5 AAA / Apple 44).
Çözüm: kritik düğmeleri `min-h-11 min-w-11`; "sabitle" ve "daralt" ikonlarını sade modda gizle.

**7.3 Kontrast (koyu menü, soluk ikincil metin). [P2, S]** Yan menü etiketleri `text-white/75`, "Kurulum ... Sıradaki" `text-text-muted` 12 px; açık tema ikincil metni için 4.5:1 doğrulanmalı (ayrı otomatik kontrast testi öneri). Koyu tema "yalnız /app ve /admin"; sistem varsayılanı sade modda "açık" olsun.

**7.4 Klavye: iyi temel var ("İçeriğe atla", odak halkası, `aria-label`). [P3]** Kısayol ipuçları gösterilirken sade kullanıcıyı yormasın (3.3). Tur kartında odak tuzağı ve Esc doğrulanmalı.

**7.5 Mobil: alt çubuk iyi ama yalnız ikon+kısa etiket; üst çubukta etiketsiz 5 ikon. [P2, S]**
390 px'te üst çubuk: menü, ara, TV, "+", zil, avatar; hepsi ikon. "TV" (ekranı aç) yaşlı kullanıcı için anlamsız ve yanlış basılır (kapatması zor).
Çözüm: mobilde "TV" ve "Düzenle" düğmelerini gizle (sade modda); ara düğmesine "Ara" etiketi.

---

## 8. Tutarlılık: mükerrer sayfa/eylem ve farklı ad aynı kavram

| Kavram | Adlar | Öneri |
|---|---|---|
| Eşleştirme | menü "Eşleştirme" · sayfa "Akıllı eşleşme motoru" · eyebrow "Talep × Portföy eşleştirme" · Ayarlar "Ağırlıklar" | "Müşteriye uygun ilanlar" |
| Kayıp-kaçak | "Kayıp-kaçak" · "Leak Shield" · "Kaçan komisyon motoru" · ana ekran "Kayıp-kaçak" | "Kaçırdığım komisyonlar" |
| Kayıp satış | "Kayıp Satış" · "Risk Altındaki Müşteriler" · "Kayıp satış dedektörü" | "Unuttuğum müşteriler" |
| Ekip | menü "Ekip Merkezi" · sayfa "Çalışan yönetimi" · "Ekip performansı" · "Ekip Ligi" · "Kıyas" | Ekip Merkezi tek ad |
| Destek | menü "Destek" · sayfa "Talepleriniz" · eyebrow "Destek merkezi" | "Destek ve yardım" |
| Kurulum | "Ofis kurulumu" · "Başlangıç" · "Kurulum %67" | "Ofis kurulumu" |
| Arama | "Ara… ⌘K" (menü) · üst çubuk arama · "Akıllı Arama" (görüşme kaydı) · `/app/arama-sonuclari` | Görüşme ekranı "Arama kayıtları" |
| Otomasyon | "Otomasyonlar" · "İş Akışları" · Ayarlar "İş akışları" | tek "Otomatik işler" altında iki sekme |
| Komisyon | "Anlaşmalar" (modül `commissions`) · "Komisyon" · "Cüzdanım" · "Kazanç" · "Onaylar" | Para: "Komisyonlarım" |
| Mükerrer eylem | Müşteri ekleme: ana ekran düğmesi + "+ Yeni" + Müşteriler "Yeni" + kurulum adımı + "Başlayalım" kartı (beş giriş) | Sade modda üç |
| Mükerrer sayfa | `/app/yatirim` ve `/app/hesaplayici` (alias var, iyi); "Kayıp Satış" ve "Akıllı Listeler" kısmen aynı iş (kimi aramalı) | Birleştirilebilir |
| Mükerrer menü | "Ana ekran" iki kez (Son kullanılanlar + Bugün) | bkz. 2.2 |
| Kişi hitabı | onboarding'de "anlaşmanı" (sen) / diğerleri "ekleyin" (siz) | "siz" |

[P2, M, `nav-config.ts` + sayfa başlıkları + `docs/DESIGN_SYSTEM.md` içine "terim sözlüğü"]

---

## 9. En kritik 10 bulgu (öncelik sırası)

1. **P0** Menü 54 giriş noktası/47 satır; danışman bile 43 satır görüyor, "Sade görünüm" yok (2.1, 4.1).
2. **P0** Metnin ~%75'i 12-14 px; yazı boyutu ayarı yok (7.1).
3. **P0** Yardım merkezi / "?" ipucu yok; "Destek" yalnız bilet formu (5.1).
4. **P0** "Yeni müşteri/portföy" yalnız 5 sekmeli tam form; "hızlı ekle" yok; boş sekmede yanıltıcı "Tamamlandı" tiki (3.1, 3.2).
5. **P1** Jargon: Leak Shield, churn, segment, otomasyon (tetikleyici→koşul→aksiyon), lig, KPI, "scraping/logActivity/immutable" sızıntıları; aynı iş 3 adla (2.3, 8).
6. **P1** Ürün turu 5 adım, 4 jargon, mobilde çalışmıyor, yeniden başlatılamıyor (1.1).
7. **P1** Ana ekran 18 blok, mobilde 6.748 px; "ne yapmalıyım" tek yerde değil (1.3, 5.4, bölüm 11).
8. **P1** Dokunma hedefleri 28-40 px (7.2); mobilde etiketsiz ikonlar ve "TV"/"Düzenle" düğmeleri (7.5).
9. **P1** Danışman menüsünde yönetim sayfaları (Otomasyon, Denetim, Ayarlar) görünüyor (4.2).
10. **P1** Arama: iki kutu, Windows'ta "⌘K", ne aranacağı belli değil (5.3).

Hızlı kazanımlar (1-2 gün): terim sözlüğü + başlık adları, danışman menüsü, onboarding CTA/dil düzeltmeleri, "Ana ekran" mükerrerini kaldırma, ⌘/Ctrl, TV/Düzenle'yi mobilde gizleme.

---

## 10. "Sade görünüm" (basit mod) tasarım önerisi

**Fikir:** Kullanıcı menüsünde tek anahtar: "Sade görünüm (önerilir)" / "Tüm özellikler". Yeni kullanıcılarda varsayılan **açık**; kayıt `user_preferences` (yoksa `localStorage` + profil) ile saklanır. Yetki matrisi değişmez; yalnız **görünürlük** değişir, hiçbir sayfa silinmez, doğrudan adres çalışmaya devam eder (`requireModulePage` aynen kalır). Sade modda yazı varsayılanı "Büyük", "Son kullanılanlar" ve sabitle ikonları gizli, sekmeli ek öğeler "Daha fazla"da.

**Her kullanıcı için yeter 12 sayfa (çekirdek, yetkisi olan görür):**

| # | Menü adı (yeni) | Yol | Modül |
|---|---|---|---|
| 1 | Ana ekran ("Bugün") | `/app` | dashboard |
| 2 | Müşteriler | `/app/musteriler` | customers |
| 3 | Talepler | `/app/talepler` | demands |
| 4 | Portföyler | `/app/portfoyler` | properties |
| 5 | Müşteriye uygun ilanlar | `/app/eslestirme` | matching |
| 6 | Randevular | `/app/randevular` | appointments |
| 7 | Görevler | `/app/gorevler` | tasks |
| 8 | Anlaşmalar | `/app/anlasmalar` | commissions |
| 9 | Komisyonlarım | `/app/komisyon` | commissions |
| 10 | Gelen Kutusu | `/app/gelen-kutusu` | calls |
| 11 | Raporlar (ofis sahibi/muhasebe) / Fiyat tahmini (danışman) | `/app/raporlar` / `/app/degerleme` | reports / valuation |
| 12 | Yardım ve destek | `/app/destek` (+ yeni yardım) | support |

Rol farkları: ofis sahibi #11 Raporlar ve "Ekip Merkezi" (12. yerine Ayarlar yok; Ayarlar üst kullanıcı menüsünde), danışman #11 Fiyat tahmini, muhasebe #3-#7 yerine Giderler, Aidat, Abonelik, sekreter #8-#9 yerine Arama kayıtları.

**"Daha fazla" altında (daraltılmış, başlıklı):** Akıllı Listeler, Tavsiyeler, Kiralama+Kira artışı, Projeler, Açık Ev, Portal Kontrol, Anahtar Takibi, Sunumlar, Ofisler Arası Ağ, Teklifler, Sözleşmeler, Akıllı Arama, Kampanyalar, Giderler, Aidat, Kayıp-kaçak, Ekip performansı, Bölge Analizi, Kayıp Satış, Ofis Panosu, Hesaplayıcılar, Yabancıya Satış, Ekip Merkezi, Otomasyonlar, İş Akışları, Uyum, Belge Merkezi, Denetim, Abonelik, Ayarlar, Ofis kurulumu (tamamlanınca).

**Uygulama izi (kod değişikliği ayrı iş):**
- `nav-config.ts`: `NavItem.tier?: "core"|"more"` ve rol bazlı çekirdek listesi; yeni `visibleSections(accessible, { mode, role })`; `ALL_NAV_HREFS` ve `resolveActiveNav` aynı kalır (etkin sayfa "Daha fazla" içindeyse bölüm otomatik açılır).
- `app-sidebar.tsx`: "Daha fazla" katlanır bölüm; mod anahtarı kullanıcı menüsünde ("Sade görünüm").
- `command-search`: sade modda bile TÜM sayfalara arama ile erişilir (menü sadeleşmesi bulunabilirliği düşürmez).
- Sözleşme testi (`nav` + `permissions` uyumu): çekirdek öğelerin her biri rolün erişilebilir modülleriyle kesişmeli; testle doğrula.
- Efor: M-L (~4-6 gün) + terim sözlüğü S + yazı boyutu M.

---

## 11. Gün içi "Sıradaki en iyi eylem" kartı (ana ekranın tepesi)

**Amaç:** Ekran açılınca tek soru: "Şimdi ne yapayım?" Tek kart, tek büyük düğme, yanında "Sonra" ve "Bugün için geç" düğmeleri. Altında en çok 2 sıradaki iş. Mevcut "Bugün kuyruğu" (`_home/bugun-ozet.tsx`) bu veriyi zaten üretiyor; kart onun **ilk maddesinin** sade ve büyük sunumudur (16-18 px, 56 px yüksek düğme). Sahte skor yok; yalnız gerçek kayıt.

**Gerçek veriye dayalı öncelik sırası (ilk eşleşen kazanır; her biri bir sorgu + doğrudan hedef):**

| Sıra | Koşul (kaynak) | Kart metni (örnek) | Büyük düğme → hedef |
|---|---|---|---|
| 1 | Bugün saati geçmiş/içindeki randevu (`appointments`) | "14:00 Ali Kaya ile randevunuz var" | "Randevuyu aç" → `/app/randevular` (filtreli) |
| 2 | Gecikmiş görev (`tasks`, vadesi geçmiş, en eski) | "'Mehmet Bey'i ara' görevi 3 gündür bekliyor" | "Şimdi ara" (tel:) / "Görevi aç" |
| 3 | Sıcak müşteri dönüş bekliyor (`customer_lead_signals`, `_home/data.ts` zaten çekiyor) | "Ayşe Hanım dün 2 kez ilan baktı; henüz aranmadı" | "WhatsApp'tan yaz" / "Ara" |
| 4 | Yetki belgesi bitiyor (`properties.authority_expires_at` < 14 gün) | "Maltepe 3+1 satış yetkisi 5 günde bitiyor" | "Yetkiyi yenile" → portföy |
| 5 | İlan teyidi gecikmiş (`overdueListingsOf`, 7+ gün) | "7 ilanı 7 gündür teyit etmediniz" | "İlanları kontrol et" → `/app/portallar` |
| 6 | Bekleyen komisyon/teklif yanıtı (`commissions` durum=bekleyen) | "2 komisyon tahsilat bekliyor" | "Komisyonları gör" |
| 7 | Kurulum eksik adım (`buildOnboarding.next`) | "Ofis profilinizi tamamlayın (1 dakika)" | "Tamamla" → ilgili `/yeni` formu |
| 8 | Hiçbiri yoksa | "Bugün için acil iş yok. Yeni bir müşteri eklemek ister misiniz?" | "Müşteri ekle" |

**Kurallar:** rol/izne uyar (danışman yalnız kendi görev, müşteri ve randevusu; ofis sahibi ek olarak tahsilat, ekip gecikmesi); "Bugün için geç" tercihi gün sonuna kadar saklanır (kayıt: `localStorage` + isteğe bağlı sunucu); tek dokunuşla işi tamamlayınca kart sıradakine geçer ve küçük bir "Tamam, bitti" geri bildirimi gösterir; kart "Sıfır çıkmaz metrik" ilkesine uyar (her madde filtrelenmiş hedefe gider); metinler bölüm 2.3 sözlüğüyle yazılır; TV modunda gizli.

**Yerleşim:** hero'nun hemen altında; kurulum şeridi, duyuru satırı ve KPI blokları sade modda kartın **altına** veya "Daha fazla göster" açılırına iner. Ana ekranda sade modda yalnız: Sıradaki eylem, Bugünkü randevular, Bugünkü görevler, Son müşteriler (4 blok; grafikler "Ayrıntılı görünüm" altında).

Efor: M (veri zaten `_home/data.ts` içinde; yeni bileşen `_home/siradaki-eylem.tsx`, birim test: öncelik sırası + rol süzgeci).

---

## 12. Önerilen uygulama sırası

1. Terim sözlüğü + başlık/menü adları + dil tutarlılığı (S, 1-2 gün, risksiz).
2. Danışman menüsü sadeleştirme + "Ana ekran" mükerrer + arama kutusu/⌘ düzeltmesi (S).
3. Yazı boyutu ayarı + 44 px hedefler + `text-xs` alt sınırı (M).
4. Hızlı ekle (müşteri, portföy, randevu) + yanıltıcı "Tamamlandı" tiki düzeltmesi (M).
5. Sade görünüm anahtarı + rol çekirdekleri (M-L).
6. "Sıradaki en iyi eylem" kartı (M).
7. Yardım merkezi + bağlam içi "?" + yeniden başlatılabilir kısa tur (M-L).
