/**
 * Yardım merkezi SSS'si — yapılandırılmış veri, TEK kaynak. /app/yardim "SSS" sekmesi okur;
 * AI asistanın ürün sorusu örnekleri de buradan beslenebilir.
 *
 * KURAL: Yalnız gerçek ürün davranışı yazılır (kaynak: help-content.ts rehberleri ve ilgili ekranlar).
 * Fiyat, tarife ve kontör rakamı SABİT YAZILMAZ: güncel fiyat /fiyatlar ve Abonelik'tedir.
 *
 * AI notu: bu veri yapay zekaya gönderilecekse çağrı yalnız src/lib/ai/openai-client.ts üzerinden gider
 * ve kişisel veri src/lib/ai/redact.ts ile maskelenir. Bu dosyada hiçbir ağ/AI çağrısı yoktur.
 */

export type FaqCategory = "baslangic" | "kayitlar" | "ekip" | "komisyon" | "paket" | "iletisim" | "ai";

export type FaqItem = {
  id: string;
  category: FaqCategory;
  q: string;
  a: string;
  href?: string;
  hrefLabel?: string;
};

export const FAQ_CATEGORIES: readonly { id: FaqCategory; label: string }[] = [
  { id: "baslangic", label: "Başlangıç ve veri taşıma" },
  { id: "kayitlar", label: "Müşteri, talep, portföy, randevu" },
  { id: "ekip", label: "Ekip, rol ve izinler" },
  { id: "komisyon", label: "Anlaşma, komisyon ve finans" },
  { id: "paket", label: "Paket, ödeme ve fatura" },
  { id: "iletisim", label: "İletişim ve mesajlaşma" },
  { id: "ai", label: "AI Asistan, kontör ve destek" },
];

const PRICE_NOTE = "Güncel fiyat /fiyatlar ve Abonelik sayfasındadır.";

export const FAQ: readonly FaqItem[] = [
  // Başlangıç
  {
    id: "ilk-adim",
    category: "baslangic",
    q: "EmlakSoft'a nereden başlamalıyım?",
    a: "Ofis kurulumu sayfasından. Ofis bilgileri, ekip, veriler, portföy, talep, randevu, tanımlar ve vitrin adımları sırayla gelir; ilerleme gerçek kayıtlarınızdan hesaplanır ve hiçbir adım zorunlu değildir.",
    href: "/app/baslangic",
    hrefLabel: "Ofis kurulumu",
  },
  {
    id: "ornek-veri",
    category: "baslangic",
    q: "Sistemi önce denemek için örnek veri yükleyebilir miyim?",
    a: "Evet. Ofis kurulumunda örnek veri yüklenir, her ekranı deneyebilirsiniz. Hazır olunca ana ekrandaki bantla örnek veriler tek tuşla silinir; gerçek kayıtlarınıza dokunulmaz.",
    href: "/app/baslangic",
    hrefLabel: "Ofis kurulumu",
  },
  {
    id: "excel-tasima",
    category: "baslangic",
    q: "Excel'deki müşteri listemi nasıl taşırım?",
    a: "Dosyayı Excel'de \"Farklı Kaydet > CSV\" ile kaydedin ve İçe aktarma sayfasından yükleyin (Müşteriler sayfasındaki \"İçe aktar\" düğmesi ve Ofis kurulumunun Veriler adımı da aynı yere götürür). Sütunları eşleyin, önizleyin, aktarın.",
    href: "/app/ice-aktarma",
    hrefLabel: "İçe aktarma",
  },
  {
    id: "xlsx-yukleme",
    category: "baslangic",
    q: "İçe aktarmada .xlsx dosyası yükleyebilir miyim?",
    a: "Hayır, .xlsx doğrudan yüklenmez. Excel'de \"Farklı Kaydet > CSV\" ile kaydedip CSV'yi yükleyin. Noktalı virgül ayraçlı ve Türkçe karakterli eski Excel çıktıları otomatik anlaşılır.",
    href: "/app/ice-aktarma",
    hrefLabel: "İçe aktarma",
  },
  {
    id: "ice-aktarma-limit",
    category: "baslangic",
    q: "Tek seferde kaç satır aktarabilirim, yanlış aktarırsam ne olur?",
    a: "Tek seferde en fazla 5.000 satır alınır; daha büyük listeyi parçalara bölün. Aktarma önce önizlenir, hatalı satırlar CSV olarak indirilir ve aktarmanın tamamı geri alınabilir.",
    href: "/app/ice-aktarma",
    hrefLabel: "İçe aktarma",
  },
  {
    id: "adim-atlama",
    category: "baslangic",
    q: "Kurulum adımlarını atlayabilir miyim?",
    a: "Evet, her adımda \"Sonra yaparım\" vardır. Atlanan adım tamamlanmış sayılmaz; ilerleme yüzdesi yalnız gerçek kayıtlarla artar.",
    href: "/app/baslangic",
    hrefLabel: "Ofis kurulumu",
  },
  {
    id: "tur-tekrar",
    category: "baslangic",
    q: "Ürün turunu tekrar izleyebilir miyim?",
    a: "Evet. Yardım sayfasının sağ üstündeki düğmeyle turu yeniden başlatırsınız; rolünüze göre ofis sahibi, yönetici, muhasebe veya danışman turu açılır.",
    href: "/app/yardim",
    hrefLabel: "Yardım",
  },
  // Kayıtlar
  {
    id: "musteri-zorunlu",
    category: "kayitlar",
    q: "Müşteri kaydı için zorunlu alan nedir?",
    a: "Yalnız ad soyad. Telefon, bölge ve talep kriterleri sonradan eklenebilir; ancak bütçe ve oda sayısı girilirse eşleştirme bunları kullanır.",
    href: "/app/musteriler/yeni",
    hrefLabel: "Müşteri ekle",
  },
  {
    id: "telefon-format",
    category: "kayitlar",
    q: "Yabancı numara girebilir miyim?",
    a: "Evet. Telefon kutusunda ülke seçilir (varsayılan Türkiye); numara ülkeye göre biçimlenir. Yabancı numara + işaretli uluslararası biçimde saklanır.",
  },
  {
    id: "talep-nedir",
    category: "kayitlar",
    q: "Talep nedir, müşteriden farkı ne?",
    a: "Müşteri kişidir; talep onun aradığı evdir (satılık/kiralık, tür, bütçe, bölge, oda). Bir müşterinin birden çok talebi olabilir. Eşleştirme talepler üzerinden çalışır.",
    href: "/app/talepler",
    hrefLabel: "Talepler",
  },
  {
    id: "eslesme-puani",
    category: "kayitlar",
    q: "Eşleşme puanı nasıl hesaplanır?",
    a: "İşlem türü, konum, bütçe, portföy türü, oda sayısı ve m² karşılaştırılır ve 100 üzerinden puan çıkar. Ağırlıkları ofis olarak Ayarlar'dan değiştirebilirsiniz. Eşleşme Talepler sayfasının Eşleşme sekmesindedir.",
    href: "/app/talepler?sekme=eslesme",
    hrefLabel: "Eşleşme",
  },
  {
    id: "portfoy-taslak",
    category: "kayitlar",
    q: "Portföyüm neden taslak kalıyor, yayınlanamıyor?",
    a: "İlan sahibi bilgileri eksik olduğu için. Zorunlu sekiz bilgi: ilan sahibi, sahibin telefonu, ilişki türü, tapu durumu, yetki sözleşmesi türü, yetki başlangıç ve bitiş tarihleri (özel/süreli yetkide), ilan kaynağı ve KVKK / iletişim onayı. Hepsi tamamlanınca ilan yayına alınır.",
    href: "/app/portfoyler",
    hrefLabel: "Portföyler",
  },
  {
    id: "yetki-tarihi",
    category: "kayitlar",
    q: "Yetki başlangıç ve bitiş tarihi her ilanda zorunlu mu?",
    a: "Hayır, yalnız özel yetki ve süreli yetki türlerinde. Bitiş tarihi başlangıçtan önce olamaz.",
  },
  {
    id: "yetki-bitis-uyari",
    category: "kayitlar",
    q: "Yetki belgesi bitmek üzereyse uyarı alır mıyım?",
    a: "Evet. Yetki belgesi 15 gün içinde biten portföyler ana ekranda uyarı olarak listelenir; satıra tıklayınca ilgili portföye gidersiniz. Otomasyonla da hatırlatma kurabilirsiniz.",
    href: "/app",
    hrefLabel: "Ana ekran",
  },
  {
    id: "portal-yayin",
    category: "kayitlar",
    q: "İlanı portallara nasıl yayınlarım?",
    a: "Portföy detayındaki \"Portale Yayınla\" bölümünü kullanın, sonra portal ilan numarasını Portal Kontrol'den bağlayın. Teyit, yenileme ve kapanış durumu Portal Kontrol'de izlenir. Portal Kontrol paketinize bağlıdır.",
    href: "/app/portallar",
    hrefLabel: "Portal Kontrol",
  },
  {
    id: "kacan-komisyon",
    category: "kayitlar",
    q: "Kaçan komisyon ne demek, kesin tutar mı?",
    a: "Portaldaki ilanınız rakibe veya ofis dışına kapandıysa kaçırdığınız komisyonun tahminidir: satış bedeli (yoksa liste fiyatı) × komisyon oranı. Portföyde oran yoksa %3 kullanılır. Kesin tutar değil, tahmindir.",
    href: "/app/kayip-kacak",
    hrefLabel: "Kaçan komisyonlar",
  },
  {
    id: "randevu-zorunlu",
    category: "kayitlar",
    q: "Randevu için hangi bilgiler zorunlu?",
    a: "Randevu türü, tarih ve saat. Müşteri, portföy ve buluşma yeri isteğe bağlıdır. Aynı saatte başka randevunuz varsa sistem uyarır.",
    href: "/app/randevular/yeni",
    hrefLabel: "Randevu planla",
  },
  {
    id: "takvim-aboneligi",
    category: "kayitlar",
    q: "Randevularımı telefon takvimime ekleyebilir miyim?",
    a: "Evet. Randevular sayfasındaki takvim aboneliği kartıyla randevularınız telefon takviminize eklenir.",
    href: "/app/randevular",
    hrefLabel: "Randevular",
  },
  // Ekip
  {
    id: "danisman-ekle",
    category: "ekip",
    q: "Ekibe nasıl danışman eklerim?",
    a: "Ekip sayfasından yeni danışman formunu açın; ad soyad, e-posta ve rolü girin. Hesap teslimi iki modludur: E-posta daveti (parola belirleme bağlantısı gider) veya Geçici parola üret (parola size bir kez gösterilir).",
    href: "/app/ekip/yeni",
    hrefLabel: "Danışman ekle",
  },
  {
    id: "davet-yinele",
    category: "ekip",
    q: "Danışman davet e-postasını almadı, ne yapmalıyım?",
    a: "Ekip listesinde \"Daveti yinele\" ile erişim bağlantısını yeniden gönderin. Bu seçenek davet edilmiş ama henüz giriş yapmamış üyeler içindir.",
    href: "/app/ekip",
    hrefLabel: "Ekip",
  },
  {
    id: "koltuk-limit",
    category: "ekip",
    q: "Koltuk limitim doldu, daha fazla danışman ekleyebilir miyim?",
    a: "Evet, ek kullanıcı (koltuk) Abonelik sayfasından eklenir; danışman formundaki \"Koltuk ekle\" bağlantısı da oraya götürür. " + PRICE_NOTE,
    href: "/app/abonelik",
    hrefLabel: "Abonelik",
  },
  {
    id: "rol-izin",
    category: "ekip",
    q: "Bir rolün neleri yapabileceğini nasıl değiştiririm?",
    a: "Ayarlar > Roller sayfasındaki izin matrisinden. Dört yetki vardır: görüntüle, ekle, düzenle, sil. Değişiklik yalnız sizin ofisinizi etkiler ve hemen geçerli olur. Tek kişiye istisna için Kullanıcı istisnaları sekmesi vardır.",
    href: "/app/ayarlar/roller",
    hrefLabel: "İzin matrisi",
  },
  {
    id: "muhasebe-gider",
    category: "ekip",
    q: "Muhasebe rolü neden Giderler sayfasını göremiyor?",
    a: "Muhasebe rolü varsayılan olarak komisyon, abonelik ve raporlara erişir; Giderler ve Aidat expenses modülündedir. Ofis sahibi Ayarlar > Roller'den bu izni vermelidir.",
    href: "/app/ayarlar/roller",
    hrefLabel: "İzin matrisi",
  },
  {
    id: "sayfa-kilit",
    category: "ekip",
    q: "Bir sayfa neden \"paketinizde yok\" diyor?",
    a: "Paket kilidi sayfa bazlıdır. Kilitli sayfada ne işe yaradığı ve hangi pakette açıldığı gösterilir. Deneme süresince kilit uygulanmaz.",
    href: "/app/abonelik",
    hrefLabel: "Abonelik",
  },
  // Komisyon
  {
    id: "komisyon-nasil",
    category: "komisyon",
    q: "Komisyon nasıl hesaplanır?",
    a: "Satış bedeli × komisyon oranı. Portföyde oran boşsa %3 alınır, KDV %20 ayrıca hesaplanır. Danışman ve ofis payı Kazanıldı sihirbazının Paylar adımında belirlenir; varsayılan pay 50/50'dir.",
    href: "/app/komisyon",
    hrefLabel: "Komisyon",
  },
  {
    id: "komisyon-elle",
    category: "komisyon",
    q: "Komisyonu elle girebilir miyim?",
    a: "Hayır. Komisyon, anlaşmayı Kapanış sekmesindeki Kazanıldı sihirbazıyla kapattığınızda kendiliğinden oluşur. Pay oranlarını sihirbazda veya Komisyon sayfasındaki pay düzenleyicide değiştirirsiniz.",
    href: "/app/komisyon",
    hrefLabel: "Komisyon",
  },
  {
    id: "kazanildi-sihirbaz",
    category: "komisyon",
    q: "Kazanıldı sihirbazı hangi adımlardan oluşur?",
    a: "Yedi adım: Tutar, Kazanıldı, Paylar, Vade, Belgeler, Anket, Bitiş. Kaybedildi seçilirse Neden, Takip ve Bitiş adımları gelir. Sihirbaz anlaşma detayının Kapanış sekmesindedir.",
    href: "/app/anlasmalar",
    hrefLabel: "Anlaşmalar",
  },
  {
    id: "kiralama-kapanis",
    category: "komisyon",
    q: "Kiralama anlaşmasını da aynı sihirbazla mı kapatırım?",
    a: "Hayır. Satış anlaşmaları Kapanış sihirbazıyla kapanır; kiralama kapanışı Kiralama ekranından yapılır.",
    href: "/app/kiralama",
    hrefLabel: "Kiralama",
  },
  {
    id: "komisyon-csv",
    category: "komisyon",
    q: "Komisyon listesini Excel'e nasıl indiririm?",
    a: "Komisyon sayfasında listeyi filtreleyin ve \"Dışa aktar\" düğmesine basın; CSV iner. Excel'de açarken ayraç olarak noktalı virgülü seçin.",
    href: "/app/komisyon",
    hrefLabel: "Komisyon",
  },
  {
    id: "komisyon-faturasi",
    category: "komisyon",
    q: "EmlakSoft müşterime komisyon faturası keser mi?",
    a: "Hayır. Komisyon sayfası tutarı, payları ve tahsilatı izleyen ofis içi defterdir. Müşteriye komisyon faturasını kendi muhasebe düzeninizden kesersiniz.",
    href: "/app/komisyon",
    hrefLabel: "Komisyon",
  },
  {
    id: "gider-aidat",
    category: "komisyon",
    q: "Giderleri ve aidatı nerede takip ederim?",
    a: "Finans bölümündeki Giderler sayfasında ofis giderlerini, Aidat sayfasında portföy aidat ve vergi ödemelerini vade ve durumla izlersiniz. İkisi de paketinize bağlıdır.",
    href: "/app/giderler",
    hrefLabel: "Giderler",
  },
  // Paket
  {
    id: "fiyat",
    category: "paket",
    q: "Paket ve ek kullanıcı fiyatları nedir?",
    a: PRICE_NOTE + " Fiyatlar burada sabit yazılmaz, çünkü değişebilir.",
    href: "/app/abonelik",
    hrefLabel: "Abonelik",
  },
  {
    id: "deneme",
    category: "paket",
    q: "Deneme süresinde neler açık, bitince ne olur?",
    a: "Deneme boyunca tüm özellikler açıktır; ana ekrandaki bantta kalan gün yazar. Deneme bitince sayfa kilitleri paketinize göre devreye girer; hangi sayfaların kilitleneceği aynı bantta ve Abonelik sayfasında görünür.",
    href: "/app/abonelik",
    hrefLabel: "Abonelik",
  },
  {
    id: "kart-guvenligi",
    category: "paket",
    q: "Kart bilgilerim EmlakSoft'ta saklanıyor mu?",
    a: "Hayır. Kart numarası, güvenlik kodu ve son kullanma tarihi EmlakSoft'ta tutulmaz; iyzico güvenli sayfasında girilir ve güvenli kasada saklanır. Abonelik sayfasında yalnız maskeli özet görünür.",
    href: "/app/abonelik",
    hrefLabel: "Abonelik",
  },
  {
    id: "faturalarim",
    category: "paket",
    q: "EmlakSoft faturalarımı nereden indiririm?",
    a: "Abonelik > Faturalar sekmesinde paket, ek kullanıcı ve kontör faturalarınız listelenir; faturayı açıp yazdırabilirsiniz.",
    href: "/app/abonelik?sekme=faturalar",
    hrefLabel: "Faturalar",
  },
  {
    id: "fatura-bilgisi",
    category: "paket",
    q: "Fatura bilgilerimi (vergi no, adres) nereden girerim?",
    a: "Ayarlar > Şirket bölümünden. Geçerli TC veya vergi numarası, adres ve şehir gerekir; eksikse Abonelik sayfası sizi uyarır.",
    href: "/app/ayarlar",
    hrefLabel: "Ayarlar",
  },
  {
    id: "davet-kazan",
    category: "paket",
    q: "Davet et ve kazan nasıl çalışır?",
    a: "Davet bağlantınızı paylaşırsınız. Ödül, davet ettiğiniz ofis ilk gerçek ödemesini yapıp bir kez yeniledikten ve bekleme süresi dolduktan sonra hesap kredisi olarak yüklenir; deneme veya kayıt tek başına ödül vermez. İade ve iptalde ödül geri alınır.",
    href: "/app/buyume",
    hrefLabel: "Davet et ve kazan",
  },
  // İletişim
  {
    id: "wa-me",
    category: "iletisim",
    q: "\"WhatsApp'tan yaz\" düğmesi mesajı gönderiyor mu?",
    a: "Hayır. Düğme wa.me bağlantısıdır: WhatsApp'ı hazır mesajla açar, göndermeyi siz yaparsınız. EmlakSoft bu mesajı göndermez ve teslim durumunu bilmez. Müşteride geçerli cep telefonu yoksa düğme devre dışıdır.",
  },
  {
    id: "wa-meta",
    category: "iletisim",
    q: "Meta WhatsApp Business API'si ne işe yarar?",
    a: "Ofis adına sistemden gönderim içindir (Ayarlar > Entegrasyonlar > İletişim kanalları). Kampanyalarda yalnız Meta tarafından onaylı şablon kullanılabilir. Tek tek yazışma için wa.me düğmesi yeterlidir.",
    href: "/app/ayarlar/entegrasyonlar",
    hrefLabel: "Entegrasyonlar",
  },
  {
    id: "kampanya",
    category: "iletisim",
    q: "Toplu mesajı nereden gönderirim?",
    a: "Kampanyalar sayfasından; İYS izinlerine uygun toplu SMS ve mesaj kampanyaları gönderilir. Kampanyalar paketinize bağlıdır.",
    href: "/app/kampanyalar",
    hrefLabel: "Kampanyalar",
  },
  // AI
  {
    id: "ai-kisisel-veri",
    category: "ai",
    q: "AI Asistan müşterilerimin telefonunu görür mü?",
    a: "Hayır. Yapay zeka çağrılarında telefon, TC kimlik, e-posta, IBAN ve kart bilgisi gönderilmeden önce maskelenir.",
    href: "/app/asistan",
    hrefLabel: "AI Asistan",
  },
  {
    id: "ai-ne-yapar",
    category: "ai",
    q: "AI Asistan'a neler sorabilirim?",
    a: "Kayıtlarınızdan özet ve öneri ister: \"Bugün kimi aramalıyım?\", \"Fiyatı yüksek portföylerim hangileri?\", \"Bu ay performansım nasıl?\" gibi. Yanıtlar öneri niteliğindedir.",
    href: "/app/asistan",
    hrefLabel: "AI Asistan",
  },
  {
    id: "kontor",
    category: "ai",
    q: "Kontör nedir, ne zaman harcanır?",
    a: "Yalnız Ada/Parsel değerlemede harcanan bakiyedir; PDF indirme, rapor detayı ve ilan analizi kontör düşürmez. Harcanacak miktar işlem öncesi ekranda gösterilir; sonuç üretilemezse veya hata olursa düşmez. Kontör süreli geçerlidir (aylık hak ay sonunda, paket seçtiğiniz 1/3/6/12 ay sonunda yanar). Yetmezse Abonelik > Kontör sekmesinden paket alınır. " + PRICE_NOTE,
    href: "/app/abonelik?sekme=kontor",
    hrefLabel: "Kontör",
  },
  {
    id: "uc-bakiye",
    category: "ai",
    q: "Hesap kredisi, kontör ve AI kotası aynı şey mi?",
    a: "Hayır, üç ayrı bakiyedir ve birbirine dönüşmez. Hesap kredisi (TL) faturalarınızdan düşer; kontör değerleme ve rapor işlemlerinde harcanır; AI kullanımı paketinizin aylık AI kotasına göre izlenir ve kontörden ya da krediden düşmez.",
    href: "/app/abonelik?sekme=kontor",
    hrefLabel: "Abonelik",
  },
  {
    id: "ai-kotasi",
    category: "ai",
    q: "AI kotamı ve kimin ne kadar kullandığını nerede görürüm?",
    a: "Ayarlar > AI kullanımı sayfasında aylık kota, kalan hak ve kullanıcı bazlı kullanım görünür (ofis yönetimine açıktır).",
    href: "/app/ayarlar/ai-kullanim",
    hrefLabel: "AI kullanımı",
  },
  {
    id: "destek-talebi",
    category: "ai",
    q: "Destek ekibine nasıl ulaşırım?",
    a: "Yardım > Destek talebi sekmesinden veya Destek talepleri sayfasından \"Yeni destek talebi\" açın. Yanıtları Taleplerim listesinden izlersiniz. Önce bu SSS'ye ve rehberlere bakmanız sorunu daha hızlı çözebilir.",
    href: "/app/destek/yeni",
    hrefLabel: "Yeni destek talebi",
  },
];

/** Metinde sabit fiyat/TL rakamı olmamasını sözleşme testi bu desenle denetler. */
export const FAQ_PRICE_PATTERN = /\d[\d.,]*\s?(TL|₺|lira)/i;
