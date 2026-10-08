/**
 * Yardım merkezi içeriği — TEK kaynak. /app/yardim sayfası ve `HelpTip` ("?")
 * ipuçları buradan okur.
 *
 * KURAL: Burada yalnız sistemde gerçekten olan davranış anlatılır. Sayılar ve
 * eşikler kodla birebir aynıdır (kaynak dosya her maddenin yanında yazılı);
 * kod değişirse buradaki metin de güncellenmelidir. Uydurma metrik yok.
 */

export type GlossaryEntry = {
  /** Bağlantı çapası (#kayip-kacak) ve HelpTip anahtarı. */
  slug: string;
  /** Ekranda görünen terim. */
  term: string;
  /** Aynı şeyin başka adları (arama ve ayırt etme için). */
  aka?: string;
  /** Tek-iki cümle: HelpTip içinde ve sözlükte görünür. */
  short: string;
  /** Sözlükte ek ayrıntı (isteğe bağlı). */
  detail?: string;
  /** Terimin ekrandaki yeri. */
  href?: string;
  hrefLabel?: string;
};

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    slug: "kayip-kacak",
    term: "Kaçan komisyon",
    aka: "Kayıp-kaçak, Leak Shield",
    short:
      "Portaldaki ilanınız rakibe veya ofis dışına kapandıysa, ne kadar komisyon kaçırdığınızı tahmin eder.",
    detail:
      "Tahmin = satış bedeli (yoksa liste fiyatı) × komisyon oranı. Portföyde oran yazılı değilse %3 kullanılır. Kesin tutar değil, tahmindir.",
    href: "/app/kayip-kacak",
    hrefLabel: "Kayıp-kaçak sayfası",
  },
  {
    slug: "eslestirme",
    term: "Eşleştirme ve eşleşme puanı",
    aka: "Akıllı eşleşme, Talep × Portföy",
    short:
      "Müşterinin istediği ile ilanın ne kadar uyduğunu 100 üzerinden gösterir. Puan yüksekse ilan o müşteriye uygundur.",
    detail:
      "Puan; işlem türü (satılık/kiralık), konum, bütçe, portföy türü, oda sayısı ve m² karşılaştırmasından çıkar. Varsayılan ağırlıklar: işlem türü 25, konum 25, bütçe 20, portföy türü 15, oda 10, m² 5. Ofis olarak Ayarlar bölümünden değiştirebilirsiniz.",
    href: "/app/eslestirme",
    hrefLabel: "Eşleştirme sayfası",
  },
  {
    slug: "lig",
    term: "Ekip Ligi",
    aka: "Lig tablosu",
    short:
      "Danışmanların aylık puan sıralaması. Puan; kapatılan anlaşma, yeni portföy, tamamlanan randevu ve görevden gelir.",
    detail:
      "Puanlar: kazanılan anlaşma 100, yeni portföy 20, tamamlanan randevu 10, tamamlanan görev 5, müşteri anketinde 9-10 puan 30, kayıp-kaçak kaydına süresi içinde yanıt 15. Kurallar herkese açıktır.",
    href: "/app/lig",
    hrefLabel: "Ekip Ligi",
  },
  {
    slug: "kpi",
    term: "KPI (Danışman sonuçları)",
    aka: "Danışman KPI, performans karnesi",
    short:
      "Her danışmanın arama, randevu, teklif ve anlaşma sayıları. Yani kimin ne kadar iş yaptığını gösteren karne.",
    href: "/app/danisman-kpi",
    hrefLabel: "Danışman KPI",
  },
  {
    slug: "playbook",
    term: "İş akışı (Playbook)",
    aka: "Hazır görev listesi",
    short:
      "Bir olay olunca (ör. yeni portföy eklenince) kendiliğinden açılan hazır görev paketi. Her adımın kime ve kaç gün sonrasına verileceğini siz belirlersiniz.",
    href: "/app/ayarlar/is-akislari",
    hrefLabel: "İş Akışları",
  },
  {
    slug: "otomasyon",
    term: "Otomasyon (tetikleyici, koşul, aksiyon)",
    aka: "Otomatik iş",
    short:
      "\"... olunca ... yap\" kuralı. Örn. \"Yeni müşteri eklenince bana görev aç\". Olay tetikleyicidir, isteğe bağlı şart koşuldur, yapılacak iş aksiyondur.",
    detail:
      "Tetikleyici örnekleri: yeni müşteri, yeni talep, yeni portföy, teklif alındı, satış tamamlandı, X gün iletişim kurulmadı, yetki belgesi bitmek üzere, randevu kaçırıldı, talep hareketsiz.",
    href: "/app/otomasyonlar",
    hrefLabel: "Otomasyonlar",
  },
  {
    slug: "segment",
    term: "Segment (Akıllı Listeler)",
    aka: "Davranışsal segment",
    short:
      "Müşterileri son görüşme tarihine ve ilgisine göre gruplara ayırır: Sıcak, İlgili, Soğuk, Uykuda. Böylece önce kimi arayacağınızı görürsünüz.",
    href: "/app/akilli-listeler",
    hrefLabel: "Akıllı Listeler",
  },
  {
    slug: "sicaklik",
    term: "Müşteri sıcaklığı",
    aka: "Sıcaklık skoru",
    short:
      "Müşterinin şu an ne kadar canlı olduğunu 0-100 arası gösterir. 70 ve üstü Sıcak, 40-69 İlgili, 15-39 Soğuk.",
    detail:
      "Puanı artıranlar: yakın zamanda görüşmek, açık talep, acil talep, portalda beğeni, açık teklif/anlaşma, yeni kayıt olmak. 15'in altında olup 90 gündür görüşülmeyen müşteri Uykuda sayılır.",
    href: "/app/akilli-listeler",
    hrefLabel: "Akıllı Listeler",
  },
  {
    slug: "lead-skoru",
    term: "Aday skoru",
    aka: "Lead skoru",
    short:
      "Yeni gelen aday müşterinin ne kadar değerli olduğunu 0-100 arası gösterir. 65 ve üstü Sıcak, 35-64 Ilık, altı Soğuk.",
    detail:
      "Telefon ve e-posta bilgisi, adayın geldiği kaynak, açık talep, görüşme, randevu, çağrı, teklif ve açık anlaşma puanı artırır. Kara listedeki müşteri 0 alır.",
    href: "/app/ayarlar/lead",
    hrefLabel: "Aday yakalama ayarları",
  },
  {
    slug: "fiyat-sagligi",
    term: "Fiyat sağlığı",
    short:
      "İlan fiyatınızın bölgenin ortalama m² fiyatına göre makul olup olmadığını gösterir. Fark %10'a kadar yeşil, %20'ye kadar sarı, daha fazlası kırmızı.",
    detail:
      "Hesap için liste fiyatı ve m² bilgisi gerekir; biri yoksa durum \"bekliyor\" kalır. Bölge fiyatı yaklaşık bir referanstır; kesin değerleme yerine geçmez.",
    href: "/app/portfoyler",
    hrefLabel: "Portföyler",
  },
  {
    slug: "komisyon-payi",
    term: "Komisyon payı",
    aka: "Komisyon, hakediş",
    short:
      "Komisyon = satış bedeli × komisyon oranı. KDV (%20) ayrıca hesaplanır; danışmanın payı yüzde olarak belirlenir, kalanı ofise kalır.",
    detail:
      "Portföyde komisyon oranı boşsa %3 kullanılır. \"KDV dahil mi?\" sorusu önemlidir: 100.000 TL komisyon KDV dahilse matrah 83.333 TL olur. Komisyon elle yazılmaz; anlaşmayı Kazanıldı yaptığınızda kendiliğinden oluşur.",
    href: "/app/komisyon",
    hrefLabel: "Komisyon",
  },
  {
    slug: "yetki-matrisi",
    term: "Yetki matrisi",
    aka: "İzin matrisi",
    short:
      "Hangi rolün (danışman, muhasebe vb.) hangi sayfada neleri yapabileceğini gösteren tablo. Dört yetki vardır: görüntüle, ekle, düzenle, sil.",
    detail:
      "Değişiklik yalnız sizin ofisinizi etkiler ve hemen geçerli olur. Tek bir kişi için istisna vermek isterseniz \"Kullanıcı istisnaları\" sekmesini kullanın.",
    href: "/app/ayarlar/roller",
    hrefLabel: "İzin matrisi",
  },
  {
    slug: "tanimlar",
    term: "Tanımlar (seçim listeleri)",
    short:
      "Formlardaki açılır listelerin seçenekleri: müşteri kaynağı, portföy türü, kayıp nedeni gibi. Kendi seçeneklerinizi ekleyebilirsiniz; sistemin hazır seçenekleri korunur.",
    href: "/app/ayarlar/tanimlar",
    hrefLabel: "Tanımlar",
  },
  {
    slug: "paket-kota",
    term: "Paketler ve kota",
    short:
      "Paketiniz hangi sayfaların açık olacağını belirler. Paketinize dahil olmayan bir sayfaya girerseniz ne işe yaradığı ve hangi pakette açıldığı gösterilir.",
    href: "/app/abonelik",
    hrefLabel: "Abonelik ve paket",
  },
  {
    slug: "ice-aktarma",
    term: "İçe aktarma",
    aka: "CSV aktarma",
    short:
      "Eski programınızdaki veya Excel'deki müşteri, portföy ve talep listesini tek seferde taşır. Dosyayı Excel'de \"Farklı Kaydet > CSV\" ile kaydedip yüklersiniz.",
    detail:
      "Dört adım: dosya ve hedef seçimi, sütun eşleme, önizleme, sonuç. Tek seferde en fazla 5.000 satır alınır. Ayraç (nokta-virgül veya virgül) ve Türkçe karakter kodlaması otomatik anlaşılır.",
    href: "/app/ice-aktarma",
    hrefLabel: "İçe aktarma",
  },
  {
    slug: "pipeline",
    term: "Satış aşamaları (Pipeline)",
    short:
      "Bir anlaşmanın yolu: Yeni, Nitelikli, Müzakere, sonunda Kazanıldı veya Kaybedildi (adlarını Tanımlar'dan değiştirebilirsiniz). Anlaşmalar sayfasında kartları aşamadan aşamaya taşırsınız.",
    href: "/app/anlasmalar",
    hrefLabel: "Anlaşmalar",
  },
] as const;

export function glossaryEntry(slug: string): GlossaryEntry | undefined {
  return GLOSSARY.find((g) => g.slug === slug);
}

export type Guide = {
  slug: string;
  title: string;
  /** Tek cümle: ne işe yarar. */
  intro: string;
  steps: readonly string[];
  href: string;
  cta: string;
};

/** Görev bazlı kılavuzlar. Menü ve düğme adları ekrandakiyle birebirdir. */
export const GUIDES: readonly Guide[] = [
  {
    slug: "musteri-ekle",
    title: "Müşteri nasıl eklenir?",
    intro: "Müşteri kaydı talep, randevu ve anlaşmanın başlangıcıdır.",
    steps: [
      "Soldaki menüden Müşteriler sayfasını açın.",
      "Sağ üstteki \"Yeni müşteri\" düğmesine basın.",
      "Kişi sekmesinde ad soyadı yazın. Zorunlu olan tek alan budur.",
      "İsterseniz telefon ve ilçeyi \"İletişim ve bölge\" sekmesine yazın.",
      "Müşteri bir şey arıyorsa \"Talep ve kriterler\" sekmesine bütçe ve oda sayısını girin; eşleştirme bunları kullanır.",
      "Kaydet düğmesine basın.",
    ],
    href: "/app/musteriler/yeni",
    cta: "Müşteri ekle",
  },
  {
    slug: "talep-eslestir",
    title: "Talebe uygun ilan nasıl bulunur?",
    intro: "Müşterinin isteğini girin, sistem portföylerinizden uygun olanları puanlasın.",
    steps: [
      "Talepler sayfasında \"Yeni talep\" ile müşterinin ne aradığını kaydedin (satılık/kiralık, tür, bütçe, bölge).",
      "Talepler sayfasındaki Eşleşme sekmesini açın.",
      "Müşterinin talebinin altında uygun ilanları ve eşleşme puanını görürsünüz. Puan yükseldikçe uyum artar.",
      "Beğendiğiniz ilanda \"Kaydet & bildir\" düğmesine basın; eşleşme kaydedilir.",
      "Aynı satırdaki \"Randevu ver\" ve \"Teklif al\" kısayollarıyla sonraki işi başlatabilirsiniz.",
    ],
    href: "/app/eslestirme",
    cta: "Eşleştirmeyi aç",
  },
  {
    slug: "randevu-planla",
    title: "Randevu nasıl planlanır?",
    intro: "Yer gösterme veya görüşme randevusunu takvime yazın.",
    steps: [
      "Soldaki menüden Randevular sayfasını açın.",
      "\"Yeni randevu\" ile formu açın (müşteri kartından \"Randevu ver\" derseniz müşteri hazır gelir).",
      "Randevu türünü, tarihi ve saati seçin. Bu üçü zorunludur.",
      "İsterseniz müşteriyi, portföyü ve buluşma yerini ekleyin.",
      "\"Randevuyu planla\" düğmesine basın. Aynı saatte başka randevunuz varsa sistem uyarır.",
    ],
    href: "/app/randevular/yeni",
    cta: "Randevu planla",
  },
  {
    slug: "teklif-ver",
    title: "Teklif nasıl kaydedilir?",
    intro: "Bir portföye gelen teklifi kayıt altına alın, kabul edilince anlaşmaya çevirin.",
    steps: [
      "Soldaki menüden Teklifler sayfasını açın (paketinizde varsa).",
      "\"Yeni teklif\" düğmesine basın.",
      "Portföyü seçin ve teklif tutarını yazın. Bu ikisi zorunludur.",
      "İsterseniz müşteriyi, geçerlilik tarihini ve notu ekleyin.",
      "\"Teklif oluştur\" düğmesine basın. Teklif kabul edilirse kayıttan anlaşmaya çevirebilirsiniz.",
    ],
    href: "/app/teklifler/yeni",
    cta: "Teklif ekle",
  },
  {
    slug: "komisyon-hesabi",
    title: "Komisyon nasıl hesaplanır?",
    intro: "Komisyon elle yazılmaz; anlaşmayı kazandığınızda kendiliğinden oluşur.",
    steps: [
      "Anlaşmalar sayfasında anlaşmayı açın ve Kapanış sekmesine geçin.",
      "Kazanıldı sihirbazını başlatın (Tutar, Kazanıldı, Paylar, Vade, Belgeler, Anket, Bitiş). Komisyon kaydı sihirbaz tamamlanınca otomatik oluşur.",
      "Hesap: satış bedeli × komisyon oranı. Portföyde oran yazılı değilse %3 alınır; KDV %20 ayrıca eklenir; varsayılan pay 50/50'dir (Paylar adımında değiştirebilirsiniz).",
      "Komisyon sayfasında danışman ve ofis payını, tahsilat durumunu görürsünüz.",
      "Rakamı önceden denemek için Komisyon sayfasındaki hesaplayıcıyı kullanın. \"KDV dahil\" seçeneğine dikkat edin.",
    ],
    href: "/app/komisyon",
    cta: "Komisyon sayfası",
  },
  {
    slug: "ice-aktar",
    title: "Excel'den veri taşıma",
    intro: "Excel'deki müşteri veya portföy listenizi tek seferde yükleyin.",
    steps: [
      "Excel dosyanızı \"Farklı Kaydet > CSV\" olarak kaydedin. .xlsx dosyası doğrudan yüklenemez.",
      "İçe aktarmayı üç yerden açabilirsiniz: Müşteriler sayfasındaki \"İçe aktar\" düğmesi, Ofis kurulumu sihirbazının Veriler adımı veya doğrudan İçe aktarma sayfası (/app/ice-aktarma).",
      "Neyi aktaracağınızı seçip dosyayı yükleyin (müşteri, portföy veya talep).",
      "Sütun eşleme adımında dosyadaki başlıkların hangi alana gittiğini kontrol edin; çoğu otomatik bulunur.",
      "Önizlemede ilk satırlara bakın, sonra aktarın. Tek seferde en fazla 5.000 satır alınır.",
      "Sonuç ekranında kaç kaydın eklendiğini ve hatalı satırları görürsünüz. Yanlış olduysa aktarmanın tamamı geri alınabilir.",
    ],
    href: "/app/ice-aktarma",
    cta: "İçe aktarmaya git",
  },
  {
    slug: "ilk-gun",
    title: "İlk gün kurulum",
    intro: "Ofisinizi yarım saatte çalışır hale getirmek için sırayla şunları yapın.",
    steps: [
      "Soldaki menüden Ofis kurulumu sayfasını açın. İlerleme çubuğu gerçek kayıtlarınızdan hesaplanır.",
      "Ofis bilgileri: ad, telefon ve şehri yazın (en az ikisi dolu olunca adım tamamlanır).",
      "Ekip: danışmanlarınızı davet edin (ayrıntı için \"Ekibe danışman ekleme\" rehberine bakın).",
      "Veriler: mevcut listenizi içe aktarın ya da ilk müşterinizi elle ekleyin. Önce denemek isterseniz örnek veri yükleyip sonra tek tuşla silebilirsiniz.",
      "Portföy, talep ve randevu: her birinden bir kayıt girin; eşleştirme ve takvim çalışmaya başlar.",
      "Tanımlar ve vitrin: kayıp nedenleri ile aşama adlarını gözden geçirin, ilanı yayınlayın.",
      "Hiçbir adım zorunlu değildir; \"Sonra yaparım\" diyebilirsiniz. Adımlar Yardım > Başlangıç sekmesinde de listelenir.",
    ],
    href: "/app/baslangic",
    cta: "Ofis kurulumunu aç",
  },
  {
    slug: "portfoy-ekle",
    title: "Portföy ekleme ve neden taslak kalır?",
    intro: "Portföy kaydı her zaman açılır; ancak ilan sahibi bilgileri eksikse ilan yayına alınamaz ve taslak kalır.",
    steps: [
      "Soldaki menüden Portföyler sayfasını açın ve yeni portföy formunu başlatın. Başlık, fiyat ve konum ile kaydı açabilirsiniz.",
      "İlanın yayına alınabilmesi için sekiz zorunlu bilgi gerekir: ilan sahibi, sahibin telefonu, ilişki türü (malik/vekil/mirasçı/kurum), tapu durumu, yetki sözleşmesi türü, yetki başlangıç ve bitiş tarihleri, ilan kaynağı, KVKK / iletişim onayı.",
      "Yetki tarihleri yalnız \"özel yetki\" ve \"süreli yetki\" türlerinde zorunludur; bitiş tarihi başlangıçtan önce olamaz.",
      "Minimum satış fiyatı ile müşteri notu zorunlu değildir; yalnız ilan sahibi puanını yükseltir.",
      "Eksik varsa portföy taslak kalır ve eksik alanlar söylenir. Tamamlayıp kaydedince ilanı yayına alabilirsiniz.",
    ],
    href: "/app/portfoyler/yeni",
    cta: "Portföy ekle",
  },
  {
    slug: "ilan-yayinla",
    title: "İlanı yayınlama ve portal kontrol",
    intro: "Hazır ilanı vitrine ve portallara çıkarın, yayın durumunu Portal Kontrol'den izleyin.",
    steps: [
      "Önce ilan sahibi bilgilerinin tam olduğundan emin olun (bir önceki rehber); eksikse ilan taslak kalır.",
      "Portföy detayında \"Portale Yayınla\" bölümünü kullanın.",
      "Portal ilan numarası veya adresini Portal Kontrol sayfasından ilanınıza bağlayın.",
      "Portal Kontrol'de teyit, yenileme ve kapanış durumunu izleyin. Portal Kontrol paketinize bağlıdır; kilitliyse Abonelik sayfası hangi pakette açıldığını gösterir.",
      "İlan portalda kapanırsa kapanış formu doldurulur; rakibe kapanan ilanlar Kaçan komisyonlar sayfasına düşer.",
      "Vitrin görünümü Ayarlar > Vitrin sayfasındadır.",
    ],
    href: "/app/portallar",
    cta: "Portal Kontrol",
  },
  {
    slug: "ekip-davet",
    title: "Ekibe danışman ekleme",
    intro: "Danışmanı iki yoldan biriyle davet edersiniz; koltuk limitiniz dolduysa önce koltuk eklenir.",
    steps: [
      "Soldaki menüden Ekip sayfasını açın ve yeni danışman formuna gidin (Ofis kurulumunda en fazla 3 kişiyi hızlıca da davet edebilirsiniz).",
      "Ad soyad, e-posta ve rolü girin.",
      "Hesap teslimi bölümünde iki mod vardır. E-posta daveti: danışmana parola belirleme bağlantısı gider, parolayı siz görmezsiniz. Geçici parola üret: parola kayıttan sonra size bir kez gösterilir, siz iletirsiniz.",
      "Davet e-postası ulaşmadıysa ya da danışman hiç giriş yapmadıysa Ekip listesinde \"Daveti yinele\" ile erişim bağlantısını yeniden gönderin.",
      "Koltuk limiti dolduysa form \"Koltuk ekle\" bağlantısı gösterir; koltuk Abonelik sayfasında eklenir. Güncel fiyat /fiyatlar ve Abonelik'te yazılıdır.",
    ],
    href: "/app/ekip/yeni",
    cta: "Danışman ekle",
  },
  {
    slug: "roller-izinler",
    title: "Rol ve izinler",
    intro: "Kim hangi sayfada neyi yapabilir, ofis olarak sizin elinizdedir.",
    steps: [
      "Ayarlar > Roller sayfasını açın; satırlar sayfa grupları, sütunlar roldür. Dört yetki vardır: görüntüle, ekle, düzenle, sil.",
      "Bir rolün izni değişince yalnız sizin ofisinizi etkiler ve hemen geçerli olur.",
      "Tek kişiye istisna vermek için \"Kullanıcı istisnaları\" sekmesini kullanın.",
      "Muhasebe rolü varsayılan olarak komisyon, abonelik ve raporları görür; Giderler sayfasını açmak için o kullanıcıya (veya muhasebe rolüne) expenses modülü izni verin.",
      "Paketiniz bir sayfayı kilitliyorsa izin olsa bile sayfa açılmaz; bu durumda Abonelik sayfasına yönlendirilirsiniz.",
    ],
    href: "/app/ayarlar/roller",
    cta: "İzin matrisi",
  },
  {
    slug: "talep-kaydi",
    title: "Talep kaydı ve eşleştirme",
    intro: "Müşterinin aradığını talep olarak girin; sistem portföylerinizi puanlasın.",
    steps: [
      "Talepler sayfasında \"Yeni talep\" ile müşteriyi seçin (ya da müşteri kartından talep açın).",
      "Satılık/kiralık, portföy türü, bütçe, bölge ve oda sayısını girin; eşleşme bu alanlardan çıkar.",
      "Aynı sayfadaki Eşleşme sekmesinde uygun ilanları ve 0-100 puanı görürsünüz (eşleştirme izniniz yoksa sekme görünmez).",
      "Beğendiğiniz ilanda \"Kaydet & bildir\" ile eşleşmeyi kaydedin; \"Randevu ver\" ve \"Teklif al\" kısayolları sonraki işi başlatır.",
      "Puan ağırlıklarını ofis olarak Ayarlar'dan değiştirebilirsiniz.",
    ],
    href: "/app/talepler/yeni",
    cta: "Talep ekle",
  },
  {
    slug: "whatsapp",
    title: "WhatsApp: wa.me bağlantısı ile Meta API farkı",
    intro: "İki farklı yol vardır; hangisini kullandığınız mesajın nasıl gittiğini belirler.",
    steps: [
      "\"WhatsApp'tan yaz\" düğmeleri wa.me bağlantısıdır: yeni sekmede WhatsApp açılır, mesaj hazır gelir, göndermeyi siz yaparsınız. Müşteride geçerli bir cep telefonu yoksa düğme devre dışı kalır.",
      "wa.me ile gönderilen mesajı EmlakSoft göndermez; teslim ve okundu durumunu bilmez.",
      "Meta WhatsApp Business API (Ayarlar > Entegrasyonlar > İletişim kanalları) ofis adına sistemden gönderim içindir; kampanyalarda yalnız Meta tarafından onaylı şablon kullanılabilir.",
      "Toplu mesaj için Kampanyalar sayfası, tek tek yazışma için wa.me düğmesi uygundur. Kampanyalar paketinize bağlıdır.",
    ],
    href: "/app/ayarlar/entegrasyonlar",
    cta: "Entegrasyonlar",
  },
  {
    slug: "randevu-takvim",
    title: "Randevuyu tamamlama ve takvim",
    intro: "Planlanan randevu görüşmeden sonra sonuçlandırılır; takvimi telefonunuza bağlayabilirsiniz.",
    steps: [
      "Randevular sayfasında liste, takvim ve hafta görünümleri vardır.",
      "Görüşme bitince randevuyu tamamlayın; tamamlanan randevu Ekip Ligi puanına yansır.",
      "Randevular sayfasındaki takvim aboneliği kartıyla randevularınızı telefon takviminize ekleyebilirsiniz.",
      "Aynı saatte iki randevu girerseniz sistem uyarır.",
    ],
    href: "/app/randevular",
    cta: "Randevular",
  },
  {
    slug: "anlasma-kapanis",
    title: "Anlaşma kapanış sihirbazı",
    intro: "Anlaşmanın kazanıldığını Kapanış sekmesindeki sihirbaz kaydeder; komisyon buradan doğar.",
    steps: [
      "Anlaşmalar sayfasında anlaşmayı açın ve Kapanış sekmesine geçin. Portföy ve müşteri bağlı, nihai tutar girilmiş olmalıdır; hazırlık listesi eksikleri gösterir. Kiralama kapanışı Kiralama ekranından yapılır.",
      "Kazanıldı sihirbazı yedi adımdır: Tutar, Kazanıldı, Paylar, Vade, Belgeler, Anket, Bitiş.",
      "Paylar adımında danışman ve ofis payı belirlenir; varsayılan pay 50/50'dir. Komisyon oranı portföyde boşsa %3, KDV %20 alınır.",
      "Vade adımında tahsilat vadesi, Belgeler adımında kapanış evrakları, Anket adımında müşteri anketi ayarlanır.",
      "Kaybedildi seçilirse sihirbaz Neden, Takip ve Bitiş adımlarıyla ilerler.",
    ],
    href: "/app/anlasmalar",
    cta: "Anlaşmalar",
  },
  {
    slug: "komisyon-defteri",
    title: "Komisyon defteri",
    intro: "Kazanılan her anlaşmanın komisyonu, payları ve tahsilat durumu Komisyon sayfasında durur.",
    steps: [
      "Soldaki menüden Komisyon sayfasını açın; Kazanç ve Onaylar sekmeleri yanındadır.",
      "Her satır bir anlaşmadır: toplam komisyon, danışman payı, ofis payı ve tahsilat durumu görünür.",
      "Tahsilat geldikçe işaretleyin; birden çok satırı toplu tahsil edebilirsiniz.",
      "Payı değiştirmek için pay düzenleyiciyi kullanın. Komisyon elle yazılmaz.",
      "Rakamı önceden denemek için sayfadaki hesaplayıcıyı kullanın.",
      "EmlakSoft müşteriye komisyon faturası kesmez; bu kayıt ofis içi defterdir.",
    ],
    href: "/app/komisyon",
    cta: "Komisyon",
  },
  {
    slug: "komisyon-disa-aktar",
    title: "Komisyon raporu (Excel / PDF / CSV)",
    intro: "Komisyon listesini muhasebeniz için Rapor merkezinden Excel, PDF ya da CSV olarak indirin.",
    steps: [
      "Komisyon sayfasında \"Raporlarda aç\" bağlantısına basın; durum ve tarih filtreniz rapora taşınır.",
      "Rapor merkezinde filtreyi gözden geçirin, önizlemeyi görün.",
      "Excel (.xlsx), PDF ya da CSV düğmesine basın. CSV noktalı virgül ayraçlıdır; Excel Türkçe doğrudan açar.",
    ],
    href: "/app/raporlar?sekme=merkez&rapor=komisyonlar",
    cta: "Komisyon raporu",
  },
  {
    slug: "giderler-aidat",
    title: "Giderler ve aidat",
    intro: "Ofis giderlerini ve portföy aidat/vergi ödemelerini kayıt altında tutun.",
    steps: [
      "Finans bölümünden Giderler sayfasını açın ve gider ekleyin.",
      "Kategori dağılımı grafiği ve tablo giderlerinizi özetler.",
      "Aidat sayfasında portföy aidat ve vergi ödemelerini vade ve durumla izlersiniz.",
      "İki sayfa da paketinize bağlıdır; kilitliyse Abonelik sayfası hangi pakette açıldığını söyler.",
      "Muhasebe rolü bu sayfaları varsayılan olarak görmez; ofis sahibi Ayarlar > Roller'den expenses iznini vermelidir.",
    ],
    href: "/app/giderler",
    cta: "Giderler",
  },
  {
    slug: "degerleme",
    title: "Değerleme motoru ve Ada/Parsel kontör",
    intro: "Değerleme sayfasında iki araç vardır: değerleme motoru ve Ada/Parsel değerleme (EmlakFiyati).",
    steps: [
      "Değerleme motoru: emsallere dayalı kaba bir fiyat aralığı üretir; ekspertiz yerine geçmez.",
      "Ada/Parsel değerleme: ada ve parsel bilgisiyle rapor üretir; bu işlem kontör harcar.",
      "Harcanacak kontör işlem öncesi ekranda gösterilir; tarife burada sabit yazılmaz. Sonuç üretilemezse veya hata olursa kontör düşmez.",
      "Rapor PDF'inin ilk indirmesi kontör harcar, tekrar indirmeler ücretsizdir.",
      "Kontör yetmezse Abonelik > Kontör sekmesinden paket alınır (satın alma ofis sahibi ve genel müdür içindir).",
    ],
    href: "/app/degerleme",
    cta: "Değerleme",
  },
  {
    slug: "paketler",
    title: "Paketler ve ek kullanıcı",
    intro: "Paketiniz hangi sayfaların açık olduğunu ve kaç kullanıcı ekleyebileceğinizi belirler.",
    steps: [
      "Güncel paketler ve fiyatlar /fiyatlar sayfasında ve Abonelik sayfasında yazılıdır; bu rehberde fiyat verilmez.",
      "Abonelik > Plan ve kullanım sekmesinde kullanıcı, aktif portföy, müşteri kaydı ve şube kullanımınızı limitleriyle görürsünüz.",
      "Ek kullanıcı (koltuk) gerekirse Abonelik sayfasındaki koltuk bölümünden eklenir.",
      "Paketinizde olmayan bir sayfaya girerseniz ne işe yaradığı ve hangi pakette açıldığı gösterilir.",
    ],
    href: "/app/abonelik",
    cta: "Abonelik",
  },
  {
    slug: "deneme-odeme",
    title: "Deneme süresi, ödeme ve kart",
    intro: "Deneme süresince tüm özellikler açıktır; ücretli plana geçince sayfa kilitleri paketinize göre devreye girer.",
    steps: [
      "Deneme boyunca paket kilidi uygulanmaz; ana ekrandaki bantta kalan gün yazılır.",
      "Deneme bitince kilitlenecek sayfalar paketinize göre belirlenir; ana ekrandaki deneme bandında ve Abonelik sayfasında görürsünüz.",
      "Ücretli plana geçmek için Abonelik sayfasından paketi seçip ödeme adımını tamamlayın. Ödeme iyzico güvenli sayfasında yapılır.",
      "Kart bilgileriniz EmlakSoft'ta tutulmaz. \"Kartımı sakla\" kutusunu işaretlerseniz maskeli özet Abonelik sayfasındaki Kayıtlı kartlar bölümünde görünür.",
      "Hesap kredinizi ödemede kullanmak için \"Hesap kredimi kullan\" kutusunu işaretleyin.",
    ],
    href: "/app/abonelik",
    cta: "Abonelik",
  },
  {
    slug: "faturalar",
    title: "Faturalar ve fatura bilgileri",
    intro: "EmlakSoft'un size kestiği fatura ile sizin müşterinize kestiğiniz fatura farklı şeylerdir.",
    steps: [
      "Abonelik > Faturalar sekmesinde EmlakSoft'un paket, ek kullanıcı ve kontör için kestiği faturalar listelenir; bir faturayı açıp yazdırabilirsiniz.",
      "Fatura bilgileriniz (geçerli TC veya vergi numarası, adres, şehir) Ayarlar > Şirket bölümünden girilir; eksikse Abonelik sayfası uyarır.",
      "Müşterinize kestiğiniz komisyon faturası EmlakSoft'ta kesilmez; kendi muhasebe düzeninizden kesersiniz. Komisyon sayfası yalnız tutarı ve tahsilatı izler.",
    ],
    href: "/app/abonelik?sekme=faturalar",
    cta: "Faturalar",
  },
  {
    slug: "davet-kazan",
    title: "Davet et ve kazan",
    intro: "Başka bir ofisi davet edin; koşullar sağlanınca hesap krediniz yüklenir.",
    steps: [
      "Soldaki menüden Davet et ve kazan sayfasını açın ve davet bağlantınızı paylaşın.",
      "Ödül; davet ettiğiniz ofis ilk gerçek ödemesini yaptıktan, bir kez yenileyip aboneliği aktif kaldıktan ve bekleme süresi dolduktan sonra yüklenir. Deneme veya kayıt tek başına ödül vermez.",
      "İade, iptal veya ters ibrazda ödül geri alınır.",
      "Ödül kuralı sayfada güncel olarak yazılıdır; tanımlı kural yoksa sayfa yalnız davetlerinizi izler.",
    ],
    href: "/app/buyume",
    cta: "Davet et ve kazan",
  },
  {
    slug: "destek-asistan",
    title: "Destek talebi ve AI Asistan",
    intro: "Cevabı rehberde bulamadıysanız önce AI Asistan'a sorun, sonra destek talebi açın.",
    steps: [
      "AI Asistan sayfası kayıtlarınızdan özet çıkarır (ör. \"Bugün kimi aramalıyım?\"). Telefon, e-posta gibi kişisel veriler yapay zekaya gitmeden önce maskelenir.",
      "Destek talebi: Yardım > Destek talebi sekmesinden veya Destek talepleri sayfasından \"Yeni destek talebi\" ile yazın.",
      "Taleplerim listesinden yanıtları izler, yazışmaya devam edersiniz.",
      "Fatura, kurulum ve teknik sorunlarda destek talebi en doğru yoldur.",
    ],
    href: "/app/asistan",
    cta: "AI Asistan",
  },
  {
    slug: "krediler",
    title: "Krediler: hesap kredisi, kontör, AI kullanımı",
    intro: "Üç ayrı bakiye vardır; her biri farklı yerde harcanır ve birbirine dönüşmez.",
    steps: [
      "Hesap kredisi (TL): davet ödülü, kampanya ve iadelerden yüklenir; paket, ek kullanıcı ve kontör faturalarınızdan düşer. Ödeme adımında \"Hesap kredimi kullan\" kutusunu işaretlersiniz.",
      "Kontör bakiyesi: Ada/parsel değerleme ve PDF rapor gibi işlemlerde harcanır. Paketinizle her ay yüklenir; yetmezse Abonelik sayfasının Kontör sekmesinden ek paket alırsınız.",
      "AI kullanımı: yapay zeka asistanı ve AI özellikleri ölçülür ve paketinizin aylık AI kotasına göre izlenir; kotası tanımlı olmayan pakette sınırsız görünür. AI kullanımı kontör bakiyenizden veya hesap kredinizden düşmez.",
      "Bakiyeleri görmek için Abonelik sayfasını açın. Hesap kredisi sekmesini yalnız ofis sahibi ve genel müdür görür.",
    ],
    href: "/app/abonelik?sekme=kontor",
    cta: "Abonelik sayfası",
  },
] as const;

/** Portföyün yayına alınması için zorunlu 8 ilan sahibi bilgisi (src/lib/property-owner/info.ts ile aynı). */
export const OWNER_REQUIRED_SUMMARY: readonly string[] = [
  "İlan sahibi",
  "Sahibin telefonu",
  "İlişki türü (malik/vekil/mirasçı/kurum)",
  "Tapu durumu",
  "Yetki sözleşmesi türü",
  "Yetki başlangıç ve bitiş tarihi (özel/süreli yetkide)",
  "İlan kaynağı",
  "KVKK / iletişim onayı",
];

/** Rehber/SSS arama süzgeci (istemci tarafı; ?q=). Büyük/küçük harf duyarsız, Türkçe uyumlu. */
export function matchesQuery(parts: readonly string[], q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("tr-TR");
  if (!needle) return true;
  return parts.join(" ").toLocaleLowerCase("tr-TR").includes(needle);
}

/** Başlangıç sekmesi: onboarding adımlarının yanındaki kısa notlar (adımlar canlı veriden gelir). */
export const FIRST_30_INTRO =
  "Ofisinizi çalışır hale getirmek için aşağıdaki sekiz adım yeterlidir. Hepsi birlikte yaklaşık yarım saat sürer. İstediğiniz adımı sonraya bırakabilirsiniz.";

export type HelpTab = "baslangic" | "rehberler" | "sss" | "sozluk" | "destek";

export const HELP_TABS: readonly { id: HelpTab; label: string }[] = [
  { id: "baslangic", label: "Başlangıç" },
  { id: "rehberler", label: "Rehberler" },
  { id: "sss", label: "SSS" },
  { id: "sozluk", label: "Sözlük" },
  { id: "destek", label: "Destek talebi" },
];

export function resolveHelpTab(raw: string | undefined): HelpTab {
  return HELP_TABS.find((t) => t.id === raw)?.id ?? "baslangic";
}
