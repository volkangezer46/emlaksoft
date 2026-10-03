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
    term: "Aday (lead) skoru",
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
      "Soldaki menüden Eşleştirme sayfasını açın.",
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
      "Anlaşmalar sayfasında anlaşmanın kartını açın.",
      "Anlaşma sonuçlandığında \"Kazanıldı + komisyon\" düğmesine basın. Komisyon kaydı bu anda otomatik oluşur.",
      "Hesap: satış bedeli × komisyon oranı. Portföyde oran yazılı değilse %3 alınır; KDV %20 ayrıca eklenir.",
      "Komisyon sayfasında danışman ve ofis payını, tahsilat durumunu görürsünüz.",
      "Rakamı önceden denemek için Komisyon sayfasındaki hesaplayıcıyı kullanın. \"KDV dahil\" seçeneğine dikkat edin.",
    ],
    href: "/app/komisyon",
    cta: "Komisyon sayfası",
  },
  {
    slug: "ice-aktar",
    title: "Eski listemi nasıl taşırım?",
    intro: "Excel'deki müşteri veya portföy listenizi tek seferde yükleyin.",
    steps: [
      "Excel dosyanızı \"Farklı Kaydet > CSV\" olarak kaydedin. .xlsx dosyası doğrudan yüklenemez.",
      "Ayarlar sayfasındaki \"İçe Aktarma\" kartını açın.",
      "Neyi aktaracağınızı seçip dosyayı yükleyin (müşteri, portföy veya talep).",
      "Sütun eşleme adımında dosyadaki başlıkların hangi alana gittiğini kontrol edin; çoğu otomatik bulunur.",
      "Önizlemede ilk satırlara bakın, sonra aktarın. Tek seferde en fazla 5.000 satır alınır.",
      "Sonuç ekranında kaç kaydın eklendiğini ve hatalı satırları görürsünüz.",
    ],
    href: "/app/ice-aktarma",
    cta: "İçe aktarmaya git",
  },
] as const;

/** Başlangıç sekmesi: onboarding adımlarının yanındaki kısa notlar (adımlar canlı veriden gelir). */
export const FIRST_30_INTRO =
  "Ofisinizi çalışır hale getirmek için aşağıdaki altı adım yeterlidir. Hepsi birlikte yaklaşık yarım saat sürer. İstediğiniz adımı sonraya bırakabilirsiniz.";

export type HelpTab = "baslangic" | "rehberler" | "sozluk" | "destek";

export const HELP_TABS: readonly { id: HelpTab; label: string }[] = [
  { id: "baslangic", label: "Başlangıç" },
  { id: "rehberler", label: "Rehberler" },
  { id: "sozluk", label: "Sözlük" },
  { id: "destek", label: "Destek talebi" },
];

export function resolveHelpTab(raw: string | undefined): HelpTab {
  return HELP_TABS.find((t) => t.id === raw)?.id ?? "baslangic";
}
