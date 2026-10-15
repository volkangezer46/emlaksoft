import type { LucideIcon } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { findActiveNavigationHref } from "@/lib/navigation";
import type { AppModule } from "@/lib/permissions";
import { DUYURU_YONETIM_HREF, layoutHrefs, navLayoutFor, NAV_BY_ROLE, type HubDef, type MobileSlot } from "@/lib/nav-roles";
import { featureForHref } from "@/lib/modules/route-table";
import { resolveActiveHubIn } from "@/lib/nav-shell";

/**
 * /app menüsünün TEK kaynağı. 55 düz link yerine 9 iş başlığı: kullanıcı önce
 * "ne yapıyorum" (bugün, müşteri, portföy, anlaşma…) seçer, sonra başlığın
 * içindeki sayfaya gider. Sayfa yolları DEĞİŞMEZ; hiçbir sayfa silinmedi, eski
 * bağlantılar ve yer imleri çalışır. Menüde görünmeyen alt sayfalar (ör.
 * /app/ayarlar/filigran, /app/ekip/izinler) bağlı oldukları öğenin içindedir
 * ve o öğe etkin görünür (en uzun yol eşleşmesi).
 *
 * Bilgi mimarisi (2026-10, bkz. docs/design/MENU_IA_2026_10.md ve UX_DEGERLENDIRME_2026-10.md §5):
 *  - NAV_SECTIONS sayfa KATALOĞUDUR (başlık > öğe > sekme): komut paleti, kırıntı ve tur buradan okur.
 *    Yan menünün görünür yapısı ise ROL BAZLI MERKEZLERDİR (`nav-roles.ts` NAV_BY_ROLE -> `hubNav`): ofis 6, danışman 5,
 *    muhasebe 4, çağrı 4 satır; her merkezin sayfaları, o sayfaların üstündeki TEK sekme şeridindedir.
 *  - Her öğenin `description`'ı komut paletinde ve menü ipucunda görünür; `keywords`
 *    yalnız arama eş anlamlılarıdır (ör. "lead" yazan Talepler'e gider; UI'da "lead" geçmez).
 *  - `shortcut` ("g m" gibi) klavye kısayolu ve palet rozetinin tek kaynağıdır
 *    (`NAV_SHORTCUTS`); keyboard-shortcuts.tsx buradan okur.
 *  - Menüde bilerek olmayan sayfalar `HIDDEN_APP_PAGES`'tedir; sözleşme testi her
 *    page.tsx'in ya menüde ya bir öğenin altında ya da bu listede olduğunu doğrular.
 */
export type NavIcon = LucideIcon;

/**
 * Menüde tek öğeye indirgenen sayfalar için sekme. Her sekme KENDİ modül
 * yetkisini korur: yetkisiz sekme gizlenir; doğrudan adres yine sayfanın
 * `requireModulePage(mod, href)` kapısından (ve paket kilidinden) geçer.
 */
export type NavTab = {
  href: string;
  label: string;
  icon: NavIcon;
  module: AppModule;
  /** Komut paletinde sekme satırının altında görünen tek cümle. */
  description?: string;
  /** Yalnız arama eş anlamlıları (UI'da gösterilmez). */
  keywords?: readonly string[];
};

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  module: AppModule;
  /** Birden çok sayfayı tek menü öğesinde toplar; ilk sekme öğenin girişidir. */
  tabs?: readonly NavTab[];
  /**
   * Sekme şeridi ÇİZİLMEYEN ama öğeyi etkin yapan ek yollar: sayfaya bir düğmeden gidilir (TV panosu).
   * Menüde ayrı öğe olmaz (mükerrer giriş yok), yolu değişmez; yetim sayfa sözleşmesi bu yolları menüde sayar.
   */
  matchPaths?: readonly string[];
  /** true: sekmelerin kendi modülü yetse de öğenin kendi `module`ü yoksa öğe hiç görünmez. */
  needsItemModule?: boolean;
  /** Komut paletinde ve menü ipucunda (title) görünen tek cümlelik açıklama. ZORUNLU (sözleşme testi). */
  description: string;
  /** Yalnız arama eş anlamlıları ("lead", "excel"…); ekranda gösterilmez. */
  keywords?: readonly string[];
  /** `g` önekli gezinme kısayolu (ör. "g m"); tek kaynak, keyboard-shortcuts.tsx ve palet buradan okur. */
  shortcut?: string;
};

export type NavSection = {
  id: string;
  title: string;
  icon: NavIcon;
  /** Başlığın iş akışı özeti (mega menü / belge). */
  description: string;
  items: NavItem[];
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "bugun",
    title: "Bugün",
    icon: ICONS.baslikBugun,
    description: "Günün özeti, randevular ve görevler.",
    items: [
      {
        href: "/app",
        label: "Bugün",
        icon: ICONS.dashboard,
        module: "dashboard",
        description: "Günün özeti, içgörüler ve hızlı eylemler",
        keywords: ["anasayfa", "pano", "özet", "brifing", "dashboard"],
        shortcut: "g h",
      },
      {
        href: "/app/randevular",
        label: "Randevular",
        icon: ICONS.randevu,
        module: "appointments",
        description: "Gösterim ve görüşme takvimi",
        keywords: ["takvim", "gösterim", "ajanda", "ziyaret"],
        shortcut: "g r",
      },
      {
        href: "/app/gorevler",
        label: "Görevler",
        icon: ICONS.gorev,
        module: "tasks",
        description: "Yapılacaklar, vadeler ve geciken işler",
        keywords: ["yapılacak", "todo", "hatırlatma", "vade"],
        shortcut: "g g",
      },
    ],
  },
  {
    id: "musteriler",
    title: "Müşteriler",
    icon: ICONS.baslikMusteri,
    description: "Müşteri kartları, talepler, gelen mesajlar, çağrı kaydı ve toplu veri girişi.",
    items: [
      {
        // Tavsiyeler Müşteriler öğesinin sekmesidir; eylem süzgeçleri (kaybedilme riski, satışa çıkabilir) listenin ?segment= süzgecidir.
        href: "/app/musteriler",
        label: "Müşteriler",
        icon: ICONS.musteri,
        module: "customers",
        tabs: [
          { href: "/app/musteriler", label: "Müşteriler", icon: ICONS.musteri, module: "customers" },
          { href: "/app/arama-listesi", label: "Arama listesi", icon: ICONS.telefon, module: "customers", description: "Bugün aranacak müşteriler sırayla; ara, sonucu kaydet, sıradakine geç", keywords: ["arama", "power dialer", "bugün ara", "telefon", "geri arama"] },
          { href: "/app/tavsiyeler", label: "Tavsiyeler", icon: ICONS.tavsiye, module: "customers", description: "Müşteri tavsiye bağlantıları ve referans zinciri", keywords: ["referans", "tavsiye"] },
          // Modül ayarı modülün içinde (yol sabit; aynı sayfa Ayarlar dizininden de açılır — tek form, iki giriş).
          { href: "/app/ayarlar/etiketler", label: "Etiketler", icon: ICONS.musteri, module: "customers", description: "Müşteri etiketlerini yeniden adlandır, birleştir ya da kaldır", keywords: ["etiket", "ayar"] },
        ],
        description: "Müşteri kartları, sıcaklık ve risk süzgeçleri, tavsiyeler",
        keywords: ["kişi", "alıcı", "malik", "mülk sahibi", "aday", "cari", "segment", "sıcak", "risk", "kaybedilme", "riskli müşteriler", "akıllı liste", "satışa çıkabilir"],
        shortcut: "g m",
      },
      // Talepler sayfasının ikinci sekmesi "Eşleşme" (?sekme=eslesme, matching izniyle gizlenir).
      {
        href: "/app/talepler",
        label: "Talepler",
        icon: ICONS.talep,
        module: "demands",
        description: "Alıcı ve kiracı talepleri, portföy eşleşmesi",
        keywords: ["lead", "aday", "istek", "başvuru", "eşleştirme", "eşleşme"],
        shortcut: "g t",
      },
      // İkinci sekme "Çağrı kaydı" (?sekme=cagri): iki sekme de `calls` modülünde.
      {
        href: "/app/gelen-kutusu",
        label: "Gelen kutusu",
        icon: ICONS.gelenKutusu,
        module: "calls",
        description: "WhatsApp, SMS, form başvuruları ve çağrı kaydı",
        keywords: ["whatsapp", "sms", "mesaj", "çağrı", "arama", "telefon", "başvuru", "inbox"],
      },
      // İçe aktarma bir EYLEM sayfasıdır: menü öğesi değil; Müşteriler/Portföyler başlığında "İçe aktar" düğmesi
      // ve komut paleti eylemi (HIDDEN_APP_PAGES gerekçesi).
    ],
  },
  {
    id: "portfoy",
    title: "Portföy",
    icon: ICONS.baslikPortfoy,
    description: "Portföy kayıtları, yayın takibi, kiralama, proje ve ağ.",
    items: [
      {
        // Anahtar Takibi ve Sunumlar Portföyler öğesinin sekmesidir (yollar değişmez).
        href: "/app/portfoyler",
        label: "Portföyler",
        icon: ICONS.portfoy,
        module: "properties",
        tabs: [
          { href: "/app/portfoyler", label: "Portföyler", icon: ICONS.portfoy, module: "properties" },
          { href: "/app/portfoy-avi", label: "Sahibinden ilanlar", icon: ICONS.portfoy, module: "prospecting", description: "Sahibinden ilan sahiplerini arayıp portföy kazanın", keywords: ["sahibinden", "ilan sahibi", "portföy avı", "aranmasın", "mal sahibi", "fsbo"] },
          { href: "/app/portfoyler/anahtarlar", label: "Anahtar takibi", icon: ICONS.anahtarTakip, module: "properties", description: "Anahtar kimde, ne zaman teslim edildi", keywords: ["anahtar", "teslim"] },
          { href: "/app/portfoyler/sunumlar", label: "Sunumlar", icon: ICONS.sunum, module: "properties", description: "Müşteriye gönderilecek portföy sunumları", keywords: ["sunum", "paylaşım", "pdf"] },
          { href: "/app/ilan-havuzu", label: "Havuz ve atama", icon: ICONS.ilanHavuzu, module: "properties", description: "Atanmamış ilanların uzmanlığa göre dağıtımı", keywords: ["havuz", "atama", "ata", "ilan ata", "dağıt", "uzmanlık"] },
          { href: "/app/ayarlar/filigran", label: "Filigran", icon: ICONS.portfoy, module: "settings", description: "İlan fotoğraflarına otomatik ofis filigranı", keywords: ["filigran", "logo", "fotoğraf", "ayar"] },
        ],
        description: "İlan ve portföy kayıtları, anahtar, sunum ve havuz",
        keywords: ["ilan", "mülk", "emlak", "gayrimenkul", "daire", "arsa", "konut"],
        shortcut: "g p",
      },
      // İlan Kontrol Merkezi: portal ilanları, kayıp/kaçak ve kapanış kayıpları TEK merkez (modül `portals`; alt sayfalar
      // /app/ilan-kontrol altında ve kendi alt gezinmesinde: Portal ilanları, Kapanış kayıpları …).
      {
        href: "/app/ilan-kontrol",
        label: "İlan kontrolü",
        icon: ICONS.ilanKontrol,
        module: "portals",
        description: "Portal ilanları, yayın takibi, kayıp-kaçak uyarıları ve kapanış kayıpları",
        keywords: ["kayıp", "kaçak", "anomali", "sla", "yayın", "kaçan komisyon", "kapanış kaybı", "kalkan", "rakip", "portal ilanları", "portal", "teyit", "sahibinden", "hepsiemlak", "emlakjet"],
      },
      {
        href: "/app/kiralama",
        label: "Mülk yönetimi",
        icon: ICONS.anahtar,
        module: "rentals",
        // Kira artışı izin modülü `valuation` (kiralama `rentals`): sekme kendi modülüyle gizlenir/gösterilir.
        tabs: [
          { href: "/app/kiralama", label: "Kiralar", icon: ICONS.anahtar, module: "rentals" },
          { href: "/app/kira-artis", label: "Kira artışı", icon: ICONS.oran, module: "valuation", description: "TÜFE'ye göre yasal kira artışı hesabı", keywords: ["tüfe", "zam", "artış"] },
          // Aidat ayrı menü öğesi değildir: yönettiğiniz kiralık daire/sitelerin aidatı Mülk yönetimi sekmesidir (yol sabit; kendi modülü expenses).
          { href: "/app/aidat", label: "Aidatlar", icon: ICONS.aidat, module: "expenses", description: "Yönettiğiniz kiralık dairelerin ve sitelerin aidatlarını, tahsilatlarını ve borçlarını takip edin", keywords: ["aidat", "ortak gider", "apartman", "site", "bina", "daire cari", "borç"] },
        ],
        description: "Yönettiğiniz kiralık mülklerin kira, aidat ve mülk sahibi ödemeleri",
        keywords: ["kira takibi", "mülk yönetimi", "kira", "kiracı", "tahakkuk", "depozito", "aidat", "site", "apartman", "mülk sahibi", "hakediş"],
      },
      {
        href: "/app/projeler",
        label: "Projeler",
        icon: ICONS.proje,
        module: "projects",
        description: "Proje ve daire stoğu, ödeme planı",
        keywords: ["inşaat", "stok", "blok", "proje satışı"],
      },
      {
        href: "/app/acik-ev",
        label: "Açık ev",
        icon: ICONS.acikEv,
        module: "open_house",
        description: "Açık ev etkinlikleri ve QR ile ziyaretçi kaydı",
        keywords: ["open house", "ziyaretçi", "etkinlik", "qr"],
      },
      {
        href: "/app/ag",
        label: "Ofis ağı",
        icon: ICONS.ag,
        module: "network",
        description: "Başka ofislerle ilan ve talep paylaşımı, ortak satış",
        keywords: ["network", "ortak satış", "paylaşım", "ağ"],
      },
    ],
  },
  {
    id: "anlasmalar",
    title: "Satış",
    icon: ICONS.baslikAnlasma,
    description: "Anlaşma hattı, teklifler ve imzalı sözleşme.",
    items: [
      {
        // Teklifler Anlaşmalar öğesinin sekmesidir (yol sabit); sekme kendi izniyle (teklifler) gizlenir.
        href: "/app/anlasmalar",
        label: "Anlaşmalar",
        icon: ICONS.anlasma,
        module: "commissions",
        tabs: [
          { href: "/app/anlasmalar", label: "Anlaşmalar", icon: ICONS.anlasma, module: "commissions" },
          { href: "/app/teklifler", label: "Teklifler", icon: ICONS.teklif, module: "offers", description: "Teklif turları, karşı teklif ve kabul", keywords: ["offer", "pazarlık", "karşı teklif"] },
        ],
        description: "Satış hattı, aşamalar ve teklifler",
        keywords: ["deal", "satış hattı", "pipeline", "pano", "kanban", "aşama"],
        shortcut: "g a",
      },
      {
        href: "/app/sozlesmeler",
        label: "Sözleşmeler",
        icon: ICONS.sozlesme,
        module: "contracts",
        tabs: [
          { href: "/app/sozlesmeler", label: "Sözleşmeler", icon: ICONS.sozlesme, module: "contracts" },
          { href: "/app/ayarlar/sozlesme-sablonlari", label: "Sözleşme şablonu", icon: ICONS.sozlesme, module: "settings", description: "Sözleşme şablonlarını ekle, düzenle, pasife al", keywords: ["şablon", "ayar"] },
        ],
        description: "Şablondan sözleşme ve SMS onaylı e-imza",
        keywords: ["e-imza", "imza", "kontrat", "şablon"],
      },
    ],
  },
  {
    id: "iletisim",
    title: "Pazarlama",
    icon: ICONS.baslikIletisim,
    description: "İYS uyumlu toplu SMS ve WhatsApp kampanyaları.",
    items: [
      {
        href: "/app/kampanyalar",
        label: "Kampanyalar",
        icon: ICONS.mesaj,
        module: "campaigns",
        tabs: [
          { href: "/app/kampanyalar", label: "Kampanyalar", icon: ICONS.mesaj, module: "campaigns" },
          { href: "/app/ayarlar/mesaj-sablonlari", label: "Mesaj şablonları", icon: ICONS.mesaj, module: "settings", description: "WhatsApp ve SMS için hazır mesaj şablonları", keywords: ["şablon", "mesaj", "ayar"] },
        ],
        description: "İYS uyumlu toplu SMS ve WhatsApp gönderimi",
        keywords: ["toplu mesaj", "iys", "pazarlama", "bülten"],
      },
    ],
  },
  {
    id: "finans",
    title: "Finans",
    icon: ICONS.baslikFinans,
    description: "Komisyon defteri, kazanç, onaylar ve giderler.",
    items: [
      {
        href: "/app/komisyon",
        label: "Komisyon",
        icon: ICONS.komisyon,
        module: "commissions",
        tabs: [
          { href: "/app/komisyon", label: "Komisyon", icon: ICONS.komisyon, module: "commissions" },
          { href: "/app/cuzdan", label: "Kazanç", icon: ICONS.cuzdan, module: "commissions", description: "Danışman kazanç cüzdanı ve ofis payı", keywords: ["cüzdan", "kazanç", "hakediş"] },
          { href: "/app/onaylar", label: "Onaylar", icon: ICONS.onay, module: "commissions", description: "Fiyat, indirim, gider ve komisyon onayları", keywords: ["onay", "approval", "bekleyen"] },
        ],
        description: "Komisyon defteri, tahsilat, kazanç ve onaylar",
        keywords: ["hakediş", "tahsilat", "cüzdan", "kazanç", "onay", "kdv"],
        shortcut: "g k",
      },
      {
        href: "/app/giderler",
        label: "Muhasebe",
        icon: ICONS.gider,
        module: "expenses",
        description: "Mini muhasebe: kasa ve banka, cari, vadeler, belgeler, KDV ve kâr-zarar",
        keywords: ["masraf", "harcama", "fiş", "kar zarar", "kâr", "zarar", "kâr-zarar", "net", "danışman kârlılığı", "gelir", "gider", "cari", "alacak", "borç", "vade", "stopaj", "nakit akışı"],
      },
    ],
  },
  {
    id: "performans",
    title: "Raporlar",
    icon: ICONS.baslikPerformans,
    description: "Kişisel karne, ofis raporları ve ekip performansı.",
    items: [
      // Kişinin kendi karnesi, hedefi ve kazancı (danışman rolünde Ekip Merkezi yerine bu giriş vardır).
      {
        href: "/app/performansim",
        label: "Performansım",
        icon: ICONS.rozet,
        module: "dashboard",
        description: "Kişisel karne, hedef ve kazanç",
        keywords: ["karne", "hedefim", "rozet", "benim"],
      },
      {
        // Raporlar kabuğu: yollar sabit, her sekme kendi sayfasının kapısını (ve paket kilidini) korur.
        href: "/app/raporlar",
        label: "Raporlar",
        icon: ICONS.rapor,
        module: "reports",
        tabs: [
          { href: "/app/raporlar", label: "Ofis", icon: ICONS.rapor, module: "reports" },
          { href: "/app/bolge-analizi", label: "Bölge", icon: ICONS.bolge, module: "reports", description: "Bölge bazlı fiyat trendi, satış süresi ve talep-arz", keywords: ["bölge", "mahalle", "harita", "trend"] },
          { href: "/app/raporlar/talep-arz", label: "Talep-arz", icon: ICONS.talepArz, module: "reports", description: "Talep ve portföy dengesi", keywords: ["arz", "denge"] },
          { href: "/app/anketler", label: "Anketler", icon: ICONS.anketor, module: "surveys", description: "Anketör kuyruğu, şablonlar, sonuçlar ve müşteri memnuniyeti (NPS)", keywords: ["anket", "anketör", "nps", "memnuniyet"] },
          { href: "/app/raporlar/lead-hizi", label: "Yanıt hızı", icon: ICONS.leadHizi, module: "reports", description: "Adaya ilk dönüş süresi", keywords: ["hız", "dönüş süresi", "lead"] },
          { href: "/app/franchise", label: "Şube karşılaştırma", icon: ICONS.sube, module: "reports", description: "Şube ve ofis bazlı karşılaştırma", keywords: ["franchise", "şube"] },
        ],
        description: "Ofis, bölge, talep-arz, memnuniyet, anket ve şube raporları",
        keywords: ["analiz", "istatistik", "rapor", "bölge", "grafik"],
      },
      {
        // Ekip performansı TEK öğe: Özet (danışman KPI), Lig, Kıyas sekmeleri (yollar sabit, her sayfa kendi kapısını korur).
        // TV panosu menü öğesi değildir: ana ekranın ve Lig'in "TV modu" düğmesinden açılır.
        href: "/app/danisman-kpi",
        label: "Ekip karnesi",
        icon: ICONS.kpi,
        // Ekip modülü olana görünür (eskiden Ekip Merkezi sekmesiydi; danışman/muhasebe görmez, kendi karnesi Performansım).
        module: "team",
        needsItemModule: true,
        tabs: [
          { href: "/app/danisman-kpi", label: "Özet", icon: ICONS.kpi, module: "reports", description: "Arama, randevu, teklif ve anlaşma performansı", keywords: ["kpi", "performans", "danışman", "kıyas", "karşılaştır", "karne"] },
          { href: "/app/lig", label: "Lig", icon: ICONS.lig, module: "reports", description: "Sıralama, rozetler ve motivasyon panosu", keywords: ["lig", "sıralama", "rozet"] },
        ],
        matchPaths: ["/app/pano-tv"],
        description: "Danışman KPI özeti, ekip ligi ve danışman kıyası",
        keywords: ["kpi", "lig", "kıyas", "sıralama", "performans"],
      },
    ],
  },
  {
    id: "araclar",
    title: "Araçlar",
    icon: ICONS.baslikArac,
    description: "Değerleme, hesaplayıcılar, AI asistan ve saha notları.",
    items: [
      {
        href: "/app/degerleme",
        label: "Değerleme",
        icon: ICONS.skor,
        module: "valuation",
        description: "Emsal tabanlı değerleme ve piyasa endeksi",
        keywords: ["ekspertiz", "emsal", "fiyat tahmini", "rayiç", "endeks", "parsel"],
        shortcut: "g d",
      },
      // Alım maliyeti + yatırım getirisi: tek sayfa, ?sekme= ile iki sekme.
      {
        href: "/app/hesaplayici",
        label: "Hesaplayıcılar",
        icon: ICONS.hesaplayici,
        module: "valuation",
        description: "Alım maliyeti ve yatırım getirisi hesapları",
        keywords: ["kredi", "roi", "tapu harcı", "yatırım", "amortisman", "hesap"],
      },
      {
        href: "/app/asistan",
        label: "AI asistan",
        icon: ICONS.ai,
        module: "dashboard",
        tabs: [
          { href: "/app/asistan", label: "AI asistan", icon: ICONS.ai, module: "dashboard" },
          { href: "/app/ayarlar/ai-kullanim", label: "AI kullanımı", icon: ICONS.ai, module: "settings", description: "Aylık AI kredisi, kalan hak ve kişi bazında kullanım", keywords: ["kredi", "kota", "ai", "ayar"] },
        ],
        description: "Ofis verinizle sohbet eden yardımcı",
        keywords: ["yapay zeka", "sohbet", "chat", "asistan", "soru"],
      },
      {
        href: "/app/mahalle-notlari",
        label: "Mahalle notları",
        icon: ICONS.mahalleNotu,
        module: "properties",
        description: "Ofis içi saha notları: ulaşım, okul, gürültü, yatırım",
        keywords: ["saha", "bölge notu", "semt", "mahalle"],
      },
      {
        href: "/app/yabanci-satis",
        label: "Yabancıya satış",
        icon: ICONS.yabanciSatis,
        module: "properties",
        description: "Yabancı alıcı için belge ve süreç kontrol listesi",
        keywords: ["vatandaşlık", "yabancı", "foreign", "döviz"],
      },
    ],
  },
  {
    id: "ofis",
    title: "Ofis",
    icon: ICONS.baslikOfis,
    description: "Ekip, abonelik, yardım ve katlanır Yönetim bölümü (ayarlar, uyum, denetim, otomasyon).",
    items: [
      {
        // Ekip: tek kabuk, mevcut sayfalar sekme olarak yeniden kullanılır.
        href: "/app/ekip",
        label: "Ekip",
        icon: ICONS.ekip,
        module: "team",
        tabs: [
          { href: "/app/ekip", label: "Ekip", icon: ICONS.ekip, module: "team" },
          // Kıyas / Danışman KPI / Lig sekmeleri "Ekip performansı" öğesine taşındı (Performans ve Raporlar).
          { href: "/app/hedefler", label: "Hedefler", icon: ICONS.hedef, module: "targets", description: "Aylık ciro ve anlaşma hedefleri", keywords: ["hedef", "kota", "target"] },
          { href: "/app/ekip/devir", label: "Danışman devri", icon: ICONS.devir, module: "team", description: "Müşteri ve portföyleri danışmanlar arasında devret", keywords: ["devir", "atama", "transfer"] },
          { href: "/app/ekip/subeler", label: "Şubeler", icon: ICONS.ekip, module: "team", description: "Şube tanımları ve bölgeleri", keywords: ["şube", "branş"] },
          { href: "/app/ekip/takimlar", label: "Takımlar", icon: ICONS.ekip, module: "team", description: "Takımlar ve takım liderleri", keywords: ["takım", "lider"] },
        ],
        // Ekip, ekip modülü olanın girişidir; modülsüz rolde (danışman) yerine Performansım vardır.
        needsItemModule: true,
        description: "Danışmanlar, hedefler, devir, şube ve takımlar",
        keywords: ["danışman", "çalışan", "personel", "ekip", "şube", "takım", "izin", "ofis merkezi"],
      },
      {
        // Ayarlar kabuğu: Genel ayar sayfası + ayar sayfaları (yollar sabit, her sayfa kendi kapısını korur). Görünen şerit
        // sırası ve adları nav-roles AYARLAR merkezindedir.
        href: "/app/ayarlar",
        label: "Ayarlar",
        icon: ICONS.ayar,
        module: "settings",
        tabs: [
          { href: "/app/ayarlar", label: "Genel", icon: ICONS.ayar, module: "settings" },
          { href: "/app/ayarlar/yetkilendirme", label: "Yetkiler", icon: ICONS.yetkilendirme, module: "settings", description: "Rol izin matrisi, kapsamlar, kişi istisnaları ve denetim günlüğü", keywords: ["rol", "roller", "izin", "yetki", "matris", "kapsam", "istisna", "yetkilendirme", "erişim"] },
          { href: "/app/ayarlar/guvenlik", label: "Güvenlik", icon: ICONS.guvenlik, module: "settings", description: "Ofis güvenlik politikası (2FA zorunluluğu, IP, oturum süresi) ve açık oturumlar", keywords: ["güvenlik", "2fa", "iki adımlı", "ip", "oturum", "politika"] },
          { href: "/app/ayarlar/entegrasyonlar", label: "Entegrasyonlar", icon: ICONS.entegrasyon, module: "settings", description: "SMS, WhatsApp, portal üyelikleri, Bakanlık e-postaları ve e-Fatura", keywords: ["entegrasyon", "netgsm", "sms", "whatsapp", "portal üyeliği", "eids", "e-fatura", "paraşüt", "nilvera"] },
          { href: "/app/ayarlar/moduller", label: "Modüller", icon: ICONS.moduller, module: "settings", description: "Kullanılmayan alanları kapat, menü sadeleşsin", keywords: ["modül", "aç kapa", "sadeleştir"] },
          { href: "/app/ayarlar/tanimlar", label: "Seçim listeleri", icon: ICONS.secimListesi, module: "settings", description: "Formlardaki açılır liste seçenekleri ve anlaşma aşama adları", keywords: ["tanım", "tanımlar", "seçim listesi", "kaynak", "kayıp nedeni", "aşama"] },
          { href: "/app/ayarlar/merkez", label: "Kurallar ve varsayılanlar", icon: ICONS.kurallar, module: "settings", description: "Yanıt süreleri, uyarı eşikleri, talep dağıtımı, komisyon ve bildirim varsayılanları", keywords: ["kural", "eşik", "sla", "yanıt süresi", "talep dağıtımı", "akıllı atama", "varsayılan", "tanımlar merkezi"] },
          { href: "/app/ayarlar/lead", label: "Aday yakalama", icon: ICONS.adayYakalama, module: "settings", description: "Web formu ve bağlantıdan gelen adaylar, sırayla atama ve hızlı yanıt", keywords: ["aday", "form", "web formu", "başvuru", "hızlı yanıt"] },
          { href: "/app/ayarlar/vitrin", label: "Vitrin", icon: ICONS.vitrin, module: "settings", description: "Ofis vitrininde görünecek bölümler ve tanıtım metni", keywords: ["vitrin", "web sitesi", "tanıtım", "seo"] },
          { href: "/app/ayarlar/cop-kutusu", label: "Çöp kutusu", icon: ICONS.copKutusu, module: "settings", description: "Silinen müşteri ve portföyleri 90 gün içinde geri alın", keywords: ["çöp", "geri al", "silinen", "kurtar"] },
          { href: "/app/ayarlar/cografya-bildir", label: "Bölge bildirimi", icon: ICONS.bolgeBildir, module: "settings", description: "Eksik ya da yanlış mahalleyi platform ekibine bildirin", keywords: ["mahalle", "il", "ilçe", "bölge", "eksik"] },
          { href: "/app/ayarlar/gercek-kullanim", label: "Gerçek kullanım", icon: ICONS.gercekKullanim, module: "settings", description: "Örnek verileri tek tuşla temizleyip gerçek kullanıma geçin", keywords: ["örnek veri", "demo sil", "gerçek kullanım", "temizle"] },
          { href: "/app/ayarlar/ozel-alanlar", label: "Özel alanlar", icon: ICONS.ozelAlan, module: "settings", description: "Müşteri, portföy, talep ve anlaşmaya ofise özel alanlar ekle", keywords: ["özel alan", "custom field", "alan ekle"] },
          { href: "/app/ayarlar/api-webhook", label: "API ve webhook", icon: ICONS.apiWebhook, module: "settings", description: "API anahtarı ve imzalı webhook olayları", keywords: ["api", "webhook", "entegrasyon"] },
          // Sayfa her üyeye açıktır (devralması istenen kişi onayı burada verir; bildirim buraya götürür); sekme ayar yetkisiyle görünür.
          { href: "/app/ayarlar/sahiplik-devri", label: "Sahiplik devri", icon: ICONS.sahiplik, module: "settings", description: "Ofis sahipliğini ekipten birine iki adımda devret", keywords: ["sahip", "devir", "devret", "ofis sahibi"] },
        ],
        description: "Ofis kimliği, yetkiler, güvenlik, entegrasyonlar ve modüller",
        keywords: ["settings", "yapılandırma", "entegrasyon", "rol", "izin", "logo", "netgsm", "kurulum", "sihirbaz"],
      },
      {
        href: "/app/abonelik",
        label: "Abonelik",
        icon: ICONS.abonelik,
        module: "billing",
        description: "Paket, fatura, analiz bakiyesi ve hesap kredisi",
        keywords: ["fatura", "ödeme", "plan", "analiz bakiyesi", "kredi", "kart", "koltuk"],
      },
      {
        // Yardım ve Destek: tek menü öğesi; yardım merkezi + mevcut destek talepleri sekme.
        href: "/app/yardim",
        label: "Yardım",
        icon: ICONS.destek,
        module: "support",
        tabs: [
          { href: "/app/yardim", label: "Yardım", icon: ICONS.destek, module: "support" },
          { href: "/app/destek", label: "Destek", icon: ICONS.destek, module: "support", description: "EmlakSoft ekibine açılan destek talepleri", keywords: ["ticket", "destek", "talep"] },
        ],
        description: "Yardım merkezi, rehberler ve destek talepleri",
        keywords: ["sss", "destek", "yardım", "ticket", "rehber", "nasıl"],
      },
      {
        // Otomasyon: kurallar + iş akışları (motorlar ayrı kalır, yalnız sayfa düzeyinde tek öğe).
        href: "/app/otomasyonlar",
        label: "Otomasyon",
        icon: ICONS.otomasyon,
        module: "settings",
        tabs: [
          { href: "/app/otomasyonlar", label: "Kurallar", icon: ICONS.otomasyon, module: "settings" },
          { href: "/app/ayarlar/is-akislari", label: "İş akışları", icon: ICONS.isAkisi, module: "settings", description: "Adım adım iş akışı senaryoları", keywords: ["workflow", "akış", "senaryo"] },
        ],
        description: "Tetikleyicili kurallar ve iş akışları",
        keywords: ["kural", "workflow", "tetikleyici", "otomatik"],
      },
      {
        href: "/app/uyum",
        label: "Uyum",
        icon: ICONS.uyum,
        module: "compliance",
        description: "KVKK, İYS izinleri, yetki belgesi ve denetim dosyası",
        keywords: ["kvkk", "iys", "yasal", "eids", "izin", "silme talebi"],
      },
      {
        href: "/app/belgeler",
        label: "Belge merkezi",
        icon: ICONS.belge,
        module: "settings",
        description: "Ofis belgeleri, evrak linkleri ve şablonlar",
        keywords: ["dosya", "evrak", "döküman", "arşiv"],
      },
      {
        // Ofis Kontrol Merkezi: danışman işlem akışı, uyarılar, kurallar ve denetim kaydı (/app/ofis-kontrol/kayit) TEK öğe.
        href: "/app/ofis-kontrol",
        label: "Ofis kontrolü",
        icon: ICONS.denetim,
        module: "team",
        description: "Danışman işlem akışı, uyarılar, onay kuralları ve denetim kaydı",
        keywords: ["kontrol", "uyarı", "kural", "audit", "log", "denetim", "kayıt", "izleme", "geçmiş"],
      },
      {
        href: "/app/buyume",
        label: "Davet et",
        icon: ICONS.davet,
        module: "settings",
        description: "Meslektaş davet et, hesap kredisi kazan",
        keywords: ["referans", "davet", "ödül", "arkadaş", "büyüme"],
      },
    ],
  },
];


/**
 * Menüde olmayan ama komut paletinde ("Git") aranabilen sayfalar. Bildirimler üst çubuktaki zilden, Profilim
 * kullanıcı menüsünden açılır; TV modu ise Ekibim merkezinin sekmesidir ama katalogda öğe değildir (yol sabit,
 * katalogda Ekip karnesi `matchPaths`'iyle tanımlıdır). Yetki = `module`.
 */
export const PALETTE_ONLY_PAGES: readonly (NavTab & { description: string })[] = [
  {
    // Ekibim şeridinin "Duyurular" sekmesi (nav-roles DUYURU_YONETIM_HREF): Bildirimler sayfasının yönetim görünümü.
    href: DUYURU_YONETIM_HREF,
    label: "Duyurular",
    icon: ICONS.duyuru,
    module: "settings",
    description: "Ekibe duyuru yayınlayın, kim okudu takip edin",
    keywords: ["duyuru", "duyuru panosu", "ilan et", "ekip mesajı"],
  },
  {
    href: "/app/bildirimler",
    label: "Bildirimler",
    icon: ICONS.bildirim,
    module: "dashboard",
    description: "Tüm bildirimler ve ofis duyuruları",
    keywords: ["duyuru", "zil", "uyarı", "haber"],
  },
  {
    href: "/app/pano-tv",
    label: "TV modu",
    icon: ICONS.panoTv,
    module: "reports",
    description: "Ofis panosunu büyük ekranda (TV) göster",
    keywords: ["tv", "pano", "ekran", "televizyon", "büyük ekran", "sunum"],
  },
  {
    href: "/app/hesabim",
    label: "Profilim",
    icon: ICONS.rozet,
    module: "dashboard",
    description: "Kişisel bilgiler, parola, görünüm ve oturumlar",
    keywords: ["hesabım", "profil", "parola", "şifre", "kartvizit", "ben"],
  },
];

export type VisibleSection = NavSection & { href: string };

/**
 * Menüde BİLEREK olmayan /app sayfaları (yönlendirme, kabuktan açılan yüzey, iç akış).
 * Anahtar = yol, değer = gerekçe. `nav-pages-contract.test.ts` her page.tsx'in ya menüde, ya bir
 * menü öğesinin alt yolu, ya da burada olduğunu doğrular; bayat kayıt (sayfası silinmiş ya da
 * menüye alınmış) testi kırar.
 */
export const HIDDEN_APP_PAGES: Readonly<Record<string, string>> = {
  "/app/arama-sonuclari": "Komut paletindeki 'Tüm sonuçları gör' hedefi; menü öğesi değil arama yüzeyi",
  "/app/askida": "Askıya alınmış/ödemesi geciken ofis bilgilendirme ekranı; kabuk yönlendirir",
  "/app/bildirimler": "Üst çubuktaki zilden ('Tüm bildirimleri gör') açılır; komut paletinde aranabilir, menü öğesi değil",
  "/app/baslangic": "Kurulum sihirbazı bir EYLEM akışıdır: ana ekran kurulum şeridi, Ayarlar dizini kartı ve komut paleti eylemi",
  "/app/hesabim": "Kullanıcı menüsünden (sağ üst) açılır; danışmanda 'Ben' merkezinin 'Profilim' sekmesi, komut paletinde aranabilir",
  "/app/hizli": "Sahada hızlı kayıt: üst çubuk 'Yeni' menüsü ve komut paleti eylemi",
  "/app/paylas-al": "Telefonun Paylaş menüsünden gelen fotoğraf/metin/kişi kartı (PWA share_target) ve çevrimdışı alınan notların karşılama sayfası; menüye girmez",
  "/app/hos-geldin": "Danışman ilk giriş karşılaması; koşul sağlanmazsa ana ekrana yönlendirir",
  "/app/ice-aktarma": "Toplu yükleme bir EYLEM sayfasıdır: Müşteriler/Portföyler başlığındaki 'İçe aktar' düğmesi ve komut paleti eylemi",
  "/app/modul-kapali": "Kapalı modül bilgilendirme sayfası (modül kapısı yönlendirir)",
  "/app/paket": "Paket yükseltme sayfası (kilitli sayfadan ve Abonelik'ten ulaşılır)",
};

export type NavShortcut = { keys: string; href: string; label: string };

/**
 * `g` önekli gezinme kısayolları — menü öğelerindeki `shortcut` alanından türetilir;
 * tek ek kayıt eski "Eşleşme" kısayoludur (sayfa içi sekme, menü öğesi değil).
 * keyboard-shortcuts.tsx ve komut paleti bu listeyi okur (sözleşme testi: benzersiz, "g " önekli).
 */
export const NAV_SHORTCUTS: readonly NavShortcut[] = [
  ...NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => (i.shortcut ? [{ keys: i.shortcut, href: i.href, label: i.label }] : []))),
  { keys: "g e", href: "/app/talepler?sekme=eslesme", label: "Eşleşme" },
];

/** Yol, ofisin KAPATTIĞI bir modüle mi ait? (çekirdek yol asla kapalı sayılmaz) */
function isClosedHref(href: string, closed: readonly string[]): boolean {
  if (closed.length === 0) return false;
  const key = featureForHref(href);
  return key !== null && closed.includes(key);
}

/** Sekmeli öğeyi erişilebilir ve açık sekmelere indirger; hiç sekme kalmazsa null. */
function visibleItem(item: NavItem, accessible: readonly AppModule[], closed: readonly string[] = []): NavItem | null {
  if (!item.tabs) return accessible.includes(item.module) && !isClosedHref(item.href, closed) ? item : null;
  if (item.needsItemModule && !accessible.includes(item.module)) return null;
  const tabs = item.tabs.filter((t) => accessible.includes(t.module) && !isClosedHref(t.href, closed));
  const first = tabs[0];
  if (!first) return null;
  return { ...item, href: first.href, module: first.module, tabs };
}

export type NavViewOptions = {
  /** Ofisin kapattığı modül anahtarları (src/lib/modules): menüde ve sekmelerde görünmez. */
  closed?: readonly string[];
};

/**
 * KATALOĞUN erişilebilir modüllere göre görünen başlıkları (komut paleti, kırıntı, tur). Yan menü bunu KULLANMAZ:
 * yan menü rol bazlı merkezlerdir (`hubNav`). Her başlığın girişi ilk görünen sayfasıdır.
 */
export function visibleSections(accessible: readonly AppModule[], opts: NavViewOptions = {}): VisibleSection[] {
  return NAV_SECTIONS.map((section) => {
    const items = section.items.flatMap((item) => visibleItem(item, accessible, opts.closed) ?? []);
    return { ...section, items, href: items[0]?.href ?? "/app" };
  }).filter((section) => section.items.length > 0);
}

/** Menü öğeleri, sekmeleri ve ek eşleşme yolları: hiçbir sayfa kaybolmaz. */
export const ALL_NAV_HREFS: readonly string[] = [
  ...new Set(NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.tabs?.map((t) => t.href) ?? []), ...(i.matchPaths ?? [])]))),
];

/** Komut paleti arama metni: etiket + açıklama + eş anlamlılar (eş anlamlılar ekranda görünmez). */
export function navSearchText(entry: { label: string; description?: string; keywords?: readonly string[] }): string {
  return [entry.label, entry.description ?? "", ...(entry.keywords ?? [])].join(" ");
}

/** Yola göre etkin katalog başlığı ve öğesi (en uzun yol eşleşmesi). */
export function resolveActiveNav(
  pathname: string,
  sections: readonly NavSection[],
): { section: NavSection | null; href: string | null } {
  // Sekme yolları, sahibi olan menü öğesini etkin yapar.
  const owner = new Map<string, string>();
  for (const item of sections.flatMap((s) => s.items)) {
    owner.set(item.href, item.href);
    for (const tab of item.tabs ?? []) owner.set(tab.href, item.href);
    for (const extra of item.matchPaths ?? []) if (!owner.has(extra)) owner.set(extra, item.href);
  }
  const hit = findActiveNavigationHref(pathname, [...owner.keys()], "/app");
  const href = hit ? (owner.get(hit) ?? null) : null;
  if (!href) return { section: null, href: null };
  const section = sections.find((s) => s.items.some((i) => i.href === href)) ?? null;
  return { section, href };
}

/* ====================================================================================================
 * Rol bazlı MERKEZ (hub) yapısı: yan menünün, mobil alt çubuğun ve tek sekme şeridinin kaynağı.
 * Merkez tanımları `nav-roles.ts` NAV_BY_ROLE'dadır; burada katalogdaki sayfalara bağlanır, yetki/kapalı modül
 * süzgecinden geçirilir. Yetki matrisi ve sayfa yolları değişmez; yalnız gruplama/etiket/görünürlük.
 * ==================================================================================================== */

/** Merkez içindeki bir sayfa: katalogdaki öğe ya da sekme (merkez içi adla). */
export type HubPage = {
  href: string;
  label: string;
  icon: NavIcon;
  module: AppModule;
  description?: string;
  keywords?: readonly string[];
  shortcut?: string;
  /** Sayfanın katalogdaki sahibi öğenin ilk yolu (rozet eşlemesi: nav-badges `itemHref`). */
  itemHref: string;
};

type PageInfo = HubPage & { itemNeeds: AppModule | null };

/** Katalogdaki her sayfa (öğe + sekme) yoluna göre; TV modu / Profilim gibi palet sayfaları da dahildir. */
const PAGE_INDEX: ReadonlyMap<string, PageInfo> = (() => {
  const map = new Map<string, PageInfo>();
  for (const item of NAV_SECTIONS.flatMap((s) => s.items)) {
    const itemNeeds = item.needsItemModule ? item.module : null;
    if (!item.tabs) {
      map.set(item.href, { href: item.href, label: item.label, icon: item.icon, module: item.module, description: item.description, keywords: item.keywords, shortcut: item.shortcut, itemHref: item.href, itemNeeds });
      continue;
    }
    const first = item.tabs[0]?.href ?? item.href;
    for (const t of item.tabs) {
      map.set(t.href, {
        href: t.href,
        label: t.label,
        icon: t.icon,
        module: t.module,
        description: t.description ?? item.description,
        keywords: t.keywords ?? item.keywords,
        shortcut: t.href === first ? item.shortcut : undefined,
        itemHref: item.href,
        itemNeeds,
      });
    }
  }
  for (const pg of PALETTE_ONLY_PAGES) {
    if (!map.has(pg.href)) map.set(pg.href, { href: pg.href, label: pg.label, icon: pg.icon, module: pg.module, description: pg.description, keywords: pg.keywords, itemHref: pg.href, itemNeeds: null });
  }
  return map;
})();

/**
 * Menüdeki GÖRÜNEN ad (TEK kaynak: nav-roles merkez şeritleri; ofis yönetimi + danışman düzeni). Komut paleti ve
 * kırıntı bu adı kullanır, böylece "Ekip", "Yetkiler", "Destek", "Portal ilanları" gibi adlar her yerde aynıdır. Aynı ad
 * birden çok sayfada geçiyorsa (ör. "Genel") merkez adıyla ayrıştırılır: "Ayarlar · Genel". Menüde olmayan sayfa
 * katalog adını kullanır.
 */
export const NAV_PAGE_LABELS: ReadonlyMap<string, string> = (() => {
  const raw = new Map<string, { hub: string; label: string }>();
  for (const layout of [NAV_BY_ROLE.owner, NAV_BY_ROLE.advisor]) {
    for (const hub of [...layout.hubs, ...layout.dock]) {
      for (const pg of hub.pages) {
        if (raw.has(pg.href)) continue;
        raw.set(pg.href, { hub: hub.label, label: pg.label ?? PAGE_INDEX.get(pg.href)?.label ?? hub.label });
      }
    }
  }
  const counts = new Map<string, number>();
  for (const v of raw.values()) counts.set(v.label, (counts.get(v.label) ?? 0) + 1);
  return new Map([...raw].map(([href, v]) => [href, (counts.get(v.label) ?? 0) > 1 && v.label !== v.hub ? `${v.hub} · ${v.label}` : v.label]));
})();

/** Katalogda sekme çizilmeyen ek yollar (matchPaths) -> sahibi sayfa: Kapanış kayıpları İlan Kontrol'ü etkin yapar. */
const EXTRA_PATH_OWNER: ReadonlyMap<string, string> = new Map(
  NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => (i.matchPaths ?? []).map((m) => [m, i.tabs?.[0]?.href ?? i.href] as const))),
);

export type NavHub = {
  id: string;
  label: string;
  icon: NavIcon;
  /** Yan menü grup başlığı (isteğe bağlı). */
  group?: string;
  /** Mobil alt çubukta kullanılan kısa ad (isteğe bağlı). */
  short?: string;
  /** Merkezin girişi: ilk görünen sayfası. */
  href: string;
  /** Görünen sayfalar (yetki + kapalı modül süzgeci uygulanmış); merkezin TEK sekme şeridi bunlardır. */
  pages: HubPage[];
};

export type HubNavModel = {
  /** Ana satırlar (bütçe sayılan). */
  hubs: NavHub[];
  /** Alt sabit satırlar: Ayarlar, Abonelik, Yardım. */
  dock: NavHub[];
  /** "Araçlar" (menü satırı değil): modülü kapalı/yetkisiz olanlar yoktur. */
  tools: HubPage[];
  /** Mobil alt çubuk yuvaları, rolün sırasıyla; görünmeyen merkez yuvası çıkmaz. */
  mobile: MobileSlot[];
};

function publicPage(info: PageInfo, label?: string): HubPage {
  return {
    href: info.href,
    label: label ?? info.label,
    icon: info.icon,
    module: info.module,
    description: info.description,
    keywords: info.keywords,
    shortcut: info.shortcut,
    itemHref: info.itemHref,
  };
}

function pageVisible(info: PageInfo, accessible: readonly AppModule[], closed: readonly string[], ownModule = false): boolean {
  if (!accessible.includes(info.module)) return false;
  if (!ownModule && info.itemNeeds && !accessible.includes(info.itemNeeds)) return false;
  return !isClosedHref(info.href, closed);
}

/** Yolun katalogdaki sayfası (tam eşleşme, yoksa en uzun ön ek: /app/ekip/123 → /app/ekip). */
function pageInfoFor(href: string): PageInfo | null {
  const path = href.split(/[?#]/)[0] ?? href;
  const exact = PAGE_INDEX.get(path);
  if (exact) return exact;
  let best: PageInfo | null = null;
  for (const [key, info] of PAGE_INDEX) {
    if (key !== "/app" && path.startsWith(`${key}/`) && (!best || key.length > best.href.length)) best = info;
  }
  return best;
}

/**
 * Bağlantı ERİŞİM SÜZGECİ (SK10 / B057): hedef sayfa rolde açılabilir mi? Menü ile aynı kural (modül izni + öğe koşulu
 * + ofisin kapattığı modül). Kart/tablo içindeki bağlantılar bununla süzülür; "rolünüz için kapalı" ekranına götüren
 * bağlantı çizilmez. Katalogda olmayan yol (ör. /app/hesabim) engellenmez.
 */
export function hrefAccessible(href: string, accessible: readonly AppModule[], closed: readonly string[] = []): boolean {
  const info = pageInfoFor(href);
  return info ? pageVisible(info, accessible, closed) : true;
}

function buildHub(def: HubDef, accessible: readonly AppModule[], closed: readonly string[], role?: string | null): NavHub | null {
  // Merkezin ana sayfa kapısı (requireModulePage ile aynı izin): yoksa merkez çıkmaz.
  if (def.gate && !accessible.includes(def.gate)) return null;
  const pages = def.pages.flatMap((ref) => {
    if (ref.roles && !(role && (ref.roles as readonly string[]).includes(role))) return [];
    const info = PAGE_INDEX.get(ref.href);
    return info && pageVisible(info, accessible, closed, ref.ownModule) ? [publicPage(info, ref.label)] : [];
  });
  const first = pages[0];
  if (!first) return null;
  return { id: def.id, label: def.label, icon: ICONS[def.icon], ...(def.short ? { short: def.short } : {}), ...(def.group ? { group: def.group } : {}), href: first.href, pages };
}

/**
 * Rolün görünür menüsü (TEK hesap; masaüstü, çekmece, mobil çubuk, sekme şeridi ve testler aynı sonucu kullanır).
 * Merkezde izinli hiçbir sayfa yoksa merkez gizlenir.
 */
export function hubNav(accessible: readonly AppModule[], opts: { role?: string | null; closed?: readonly string[] } = {}): HubNavModel {
  const layout = navLayoutFor(opts.role);
  const closed = opts.closed ?? [];
  const build = (defs: readonly HubDef[]) => defs.flatMap((d) => buildHub(d, accessible, closed, opts.role) ?? []);
  const hubs = build(layout.hubs);
  const dock = build(layout.dock);
  const tools = layout.tools.flatMap((href) => {
    const info = PAGE_INDEX.get(href);
    return info && pageVisible(info, accessible, closed) ? [publicPage(info)] : [];
  });
  const ids = new Set(hubs.map((h) => h.id));
  const mobile = layout.mobile.filter((slot) => slot === "menu" || slot === "new" || ids.has(slot));
  return { hubs, dock, tools, mobile };
}

export type ActiveHub = { hub: NavHub | null; pageHref: string | null; inDock: boolean; inTools: boolean };

/**
 * Yola göre etkin merkez ve sayfa (en uzun yol eşleşmesi). Detay sayfaları (/app/musteriler/123) ve
 * `matchPaths` ek yolları (Kapanış kayıpları) sahibi sayfanın merkezini etkin yapar.
 */
export function resolveActiveHub(pathname: string, nav: HubNavModel): ActiveHub {
  return resolveActiveHubIn(pathname, nav, EXTRA_PATH_OWNER);
}

/** `matchPaths` ek yolları → sahibi sayfa (kabuk modeli istemciye düz veri olarak taşır: nav-shell `extra`). */
export function navExtraPathOwners(): readonly (readonly [string, string])[] {
  return EXTRA_PATH_LIST;
}
const EXTRA_PATH_LIST: readonly (readonly [string, string])[] = [...EXTRA_PATH_OWNER];

/**
 * Sekme şeridi için etkin merkez: önce rolün kendi menüsü; sayfa rolün menüsünde yoksa (ör. danışman Ctrl+K ile
 * Kampanyalar'a gitti) ofis yöneticisi düzeninin merkezi kullanılır, böylece her sayfanın bir sekme şeridi olur.
 */
export function resolveStripHub(pathname: string, accessible: readonly AppModule[], opts: { role?: string | null; closed?: readonly string[] } = {}): ActiveHub {
  const own = resolveActiveHub(pathname, hubNav(accessible, opts));
  if (own.hub || own.inTools) return own;
  return resolveActiveHub(pathname, hubNav(accessible, { ...opts, role: "owner" }));
}

/** Rolün menüsünde (merkez, alt sabit ya da araç olarak) yer alan tüm yollar: yetim denetimi ve testler için. */
export function roleLayoutHrefs(role: string | null | undefined): string[] {
  return layoutHrefs(navLayoutFor(role));
}
