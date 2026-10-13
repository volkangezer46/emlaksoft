# Bakanlık (EİDS) yetki e-postaları: Ofis kılavuzu

Ticaret Bakanlığı, bir malik e-Devlet üzerinden ofisinize ilan yetkisi verdiğinde ya da bu yetkiyi iptal ettiğinde bir e-posta gönderebilir.

- Gönderen: **eids.yetki@ticaret.gov.tr**
- Konu: "Elektronik İlan Doğrulama Sistemi (EİDS) Taşınmaz Yetkilendirme Hakkında"

EmlakSoft bu e-postaları okuyup ilgili portföyle eşleştirir ve gerekli görevleri açar.

> Önemli: Bakanlık her işlemde e-posta göndermeyebilir. Bu yüzden EmlakSoft e-postayı tek kaynak olarak kullanmaz, bir **denetim sinyali** olarak kullanır. Yetki durumunu ayrıca portföy ekranından elle de teyit etmeniz gerekir.

---

## 1. Bakanlık e-postaları hangi adrese gelir?

**[DOĞRULANMADI, güçlü çıkarım]** Bakanlık bunu hiçbir yerde yazılı olarak belirtmiyor. Ancak yetki kişiye değil, **yetki belgeli işletmeye** veriliyor. TTBS'de görünen işletme e-postası da şu kaynaklardan otomatik çekiliyor:

| İşletme türü | E-postanın geldiği kaynak |
|---|---|
| Şirket veya şahıs tacir (ticari işletme) | **MERSİS** |
| Esnaf işletmesi | **ESBİS** (Esnaf Sicil) |

Bu yüzden e-postalar büyük olasılıkla bu sistemlerde kayıtlı işletme e-postasına gidiyor. Kesin bilgi için Bakanlık çağrı merkezini arayın: **444 8 482**.

### TTBS'de e-postanızı nasıl görürsünüz?
1. https://ttbs.gtb.gov.tr adresine gidin. **"e-Devlet ile Giriş"** seçeneğiyle girin.
2. Ana sayfada "Yeni Başvuru", "Başvurularım" ve **"Yetki Belgelerim"** bölümlerini görürsünüz.
3. İşletme bilgilerini açın (rehberde: Yeni Başvuru > işletme seçimi > **"İşletme Detay Bilgileri"**). **E-Posta** alanındaki adres MERSİS'ten (ya da esnafsanız ESBİS'ten) gelir. Bu ekranda adres **değiştirilemez**. *(Menü adları 2018 tarihli TTBS rehberine göre yazıldı, güncel ekranda farklı olabilir.)*
4. Yetki belge numaranızı aynı yerden ya da https://ttbs.gtb.gov.tr/Home/BelgeSorgula adresinden öğrenebilirsiniz. Bu numarayı EmlakSoft'ta **Ayarlar > Marka ve kimlik > Yetki belgesi no** alanına girin. Malikler e-Devlet'te yetki verirken bu numarayı kullanır.

### E-postayı nasıl değiştirirsiniz?
- **Ticari işletme:** Bağlı olduğunuz **Ticaret Sicil Müdürlüğüne** başvurun ya da MERSİS'ten (https://mersis.gtb.gov.tr, e-imza gerekir) güncelleyin. *(MERSİS'teki menü yolu doğrulanmadı.)*
- **Esnaf işletmesi:** Bağlı olduğunuz **esnaf odası** ya da **Esnaf Sicil Müdürlüğü** üzerinden güncelleyin.
- Değişiklik yetki belgenizdeki bir bilgiyi etkiliyorsa, değişiklikten itibaren **10 gün içinde** TTBS'den tadil başvurusu yapmanız gerekir (Yönetmelik md. 8). E-postanın belgede yazılı bir bilgi olup olmadığı **doğrulanmadı**.
- **Danışmanların e-postası ayrı bir yerde tutulur.** Yolu: TTBS > "Sözleşmeli İşletme ve Danışman Bildirimi" > işletme > "Danışman Bildirimi" > ilgili danışman > **"Düzenle"**. Bakanlık e-postalarının danışman adresine gittiğine dair bir kanıt yok.

> Pratik öneri: Bakanlık e-postalarının geldiği kutu, ofis sahibinin günlük kullandığı kutu olmalı. Ortak "info@" kutusuysa, iletme kuralını o kutuya kurun.

---

## 2. EmlakSoft'a iletme: kurulum

EmlakSoft size özel bir alma adresi üretir. Adresi **Ayarlar > Entegrasyonlar > Bakanlık (EİDS) e-postaları** kartında bulursunuz. Örnek:

`yetki-7k2m9q4x8p3r@eids.emlaksoft.com.tr`

- Bu adresi kimseyle paylaşmayın.
- Adres sızarsa kartta **"Adresi yenile"** butonuna basın. Eski adres hemen geçersiz olur.

**Kural:** Gelen kutunuzun tamamını değil, **yalnız eids.yetki@ticaret.gov.tr adresinden gelenleri** iletin. EmlakSoft başka bir göndericiden gelen e-postayı okumadan siler; yalnız "reddedildi" diye bir kayıt düşer.

### Gmail (kişisel @gmail.com)
1. Bilgisayardan Gmail'i açın. Sağ üstteki dişli simgesine, ardından **"Tüm ayarları görün"**e basın.
2. **"Yönlendirme ve POP/IMAP"** sekmesinde **"Yönlendirme adresi ekle"**ye basın ve EmlakSoft adresinizi yazın.
3. Gmail bu adrese bir **onay kodu** gönderir. Kod birkaç dakika içinde EmlakSoft'taki kartta görünür. Kodu Gmail'e yazın ve onaylayın.
4. Bu sekmede **"Gelen postanın bir kopyasını yönlendir"** seçeneğini AÇMAYIN. Böylece yalnız filtreye uyan e-postalar iletilir.
5. **"Filtreler ve engellenen adresler"** sekmesinde **"Yeni filtre oluştur"**a basın. **Kimden** alanına `eids.yetki@ticaret.gov.tr` yazın, sonra **"Filtre oluştur"**a basın.
6. **"Şu adrese yönlendir"** kutusunu işaretleyip EmlakSoft adresini seçin. İsterseniz **"Eşleşen ileti dizilerine de filtre uygula"** seçeneğini de işaretleyin, sonra **"Filtre oluştur"**a basın.
7. Eski e-postalar otomatik iletilmez. Onları **.eml olarak indirip** EmlakSoft'a yükleyin (bkz. bölüm 3).

### Google Workspace (kurumsal Gmail)
Adımlar Gmail ile aynı. Yalnız şirket yöneticisi dış adrese otomatik iletmeyi kapatmış olabilir. Bu durumda yöneticinin Yönetici Konsolu > Gmail > Son kullanıcı erişimi > **"Otomatik yönlendirme"** ayarını açması gerekir. *(Menü yolu doğrulanmadı.)*

### Outlook.com / Hotmail / Live
1. outlook.com'da dişli simgesine basın: **Ayarlar > Posta > Kurallar > "+ Yeni kural ekle"**.
2. Kurala bir ad verin, örneğin "EİDS EmlakSoft".
3. **Koşul:** "Gönderen" > `eids.yetki@ticaret.gov.tr`.
4. **Eylem:** **"Şuraya ilet"** (Forward to) > EmlakSoft adresiniz. Outlook onay kodu istemez.
5. **"Kaydet"**e basın.

### Microsoft 365 (kurumsal Outlook)
Kural kurulumu Outlook.com ile aynı. Ancak Microsoft 365'te dış adrese otomatik iletme **varsayılan olarak engelli olabilir** (giden istenmeyen posta politikası). Bu durumda BT yöneticinizin, Defender'daki **Giden istenmeyen posta ilkesi > Otomatik iletme** ayarını sizin kutunuz için açması gerekir.

### Yandex Mail
1. **Ayarlar > E-posta işleme kuralları > "Kural oluştur"**.
2. **Koşul:** "Kimden" (From) içerir `eids.yetki@ticaret.gov.tr`.
3. **Eylem:** **"Adrese ilet"**, ardından EmlakSoft adresi. Yandex şifrenizi isteyip alıcı adrese bir onay e-postası gönderebilir. Bu onay bağlantısı EmlakSoft kartında görünür.
4. Bu menü adları **[DOĞRULANMADI]**. Yandex arayüzü dile göre değişebilir.

### Hosting / cPanel e-postası (info@ofisiniz.com)
- **cPanel:** **E-posta > E-posta Filtreleri** (hesap bazında) > yeni filtre. Kural: "From" **equals** `eids.yetki@ticaret.gov.tr`. Eylem: **"Redirect to email"** > EmlakSoft adresi.
- **Plesk ve diğer paneller:** Benzer bir "filtre/yönlendirme" menüsü vardır. Burada da tüm postayı değil, **yalnız bu göndericiyi** iletin.

### Kurulumu test etme
Kartta **"Test durumu"** alanı var:
- İlk gerçek EİDS e-postası geldiğinde ya da Gmail onay kodu ulaştığında kart **"Bağlı"** olur.
- 90 gün boyunca hiç e-posta gelmezse kart sarıya döner. Bu her zaman bir sorun olduğu anlamına gelmez, çünkü o dönemde hiç yetki işlemi olmamış olabilir.

---

## 3. E-postayı elle ekleme (her zaman çalışır)

- **İlan Kontrol > Yetki > "Bakanlık e-postası ekle"** ekranına girin.
- Bilgisayardaysanız e-postayı **.eml olarak indirip** yükleyin:
  - Gmail: e-postayı açın, ⋮ menüsü > **"İletiyi indir"**.
  - Outlook: **"Farklı kaydet"**.
- Bu, gönderenin doğrulanabildiği en güvenli yoldur.
- Telefondaysanız e-posta metnini kopyalayıp yapıştırabilirsiniz. Ancak yapıştırılan metin **"doğrulanmamış kaynak"** sayılır ve uygulanmadan önce ofis sahibi ya da müdür onayı gerekir.

---

## 4. e-Devlet'te yetkiyi sorgulama ve teyit

- **İşletmenin kendi yetki listesini görebildiği resmi bir ekran bulunamadı [DOĞRULANMADI].** Yetkiyi yalnız **malik** görür.
- **Malik ne yapar:** e-Devlet'te **"EİDS Taşınmaz İlanı Yetkilendirme İşlemleri"** hizmetine girer. **"Yetkilendirme İşlemleri"**nde verdiği yetkiyi, bitiş tarihini, **"Süreyi Uzat"** (en az 3 ay) ve **"İptal Et"** düğmelerini görür.
- **Danışman ne yapar:** Portföy ekranında **"Malikten teyit iste"** butonuna basar. Malike SMS veya WhatsApp ile, e-Devlet ekranının görüntüsünü göndermesini isteyen bir mesaj gider. Gelen görüntü portföye **belge** olarak yüklenir ve kaynak "belge" diye kaydedilir.
- **Portaldan teyit:** Taşınmaz numarasıyla ilan girerken ya da yenilerken portal EİDS sorgusu yapar. Sonuç olumluysa (ilanda EİDS logosu görünür) danışman portföyde **"Portalda doğrulandı"** diye işaretler.
- **Taşınmaz numarası nerede bulunur:** e-Devlet > "Tapu Bilgileri Sorgulama" > "Taşınmaz Bilgileri" yolunda ya da yeni tip tapu senedinin üzerinde. Bu numarayı malikten alın.

---

## 5. İptal e-postası gelirse ne yapmalısınız?

- **İlan kendiliğinden kalkmaz.** Bakanlık rehberine göre iptal ilanı yayından düşürmez. Yalnız yeni ilan girmeyi ve ilanın yenilenmesini engeller.
- Yetkisiz ilan vermek yasak (Yönetmelik md. 14/2-j). Yetki bittiğinde ilanın **3 gün içinde** kaldırılması gerekir (md. 14/2-h).
- 2026 yılı için ihlal başına idari para cezası **28.620 – 858.620 TL**. Aykırılık tekrarlanırsa yetki belgesi iptal edilebilir.
- EmlakSoft bu durumda **ACİL** bir görev açar. Görevde, ofisinizin üye olduğu portallardaki ilanlar, vitrin ve sosyal medya paylaşımları tek tek listelenir. Her kaldırma işaretlenmeden görev kapanmaz.

---

## Uygulama içinde nerede?

| Yer | İçerik |
|---|---|
| **Ayarlar > Entegrasyonlar > "Bakanlık (EİDS) e-postaları"** kartı | Alma adresi, sağlayıcıya göre kurulum adımları (sekmeler halinde), onay kodu, son e-posta zamanı |
| **İlan Kontrol > Yetki** | Bu kılavuzun kısa hali ve "Bakanlık e-postası ekle" |
| **Yardım merkezi** | `eids-bakanlik-epostalari` makalesi (help_articles) |
| **Hoş geldin akışı** | "Yetki belgesi no" ve "EİDS e-posta iletme" adımları |
| **Destek** | Ticaret Bakanlığı **444 8 482** |