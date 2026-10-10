import type { LucideIcon } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { findActiveNavigationHref } from "@/lib/navigation";
import type { AppModule } from "@/lib/permissions";
import { layoutHrefs, navLayoutFor, type HubDef, type MobileSlot } from "@/lib/nav-roles";
import { featureForHref } from "@/lib/modules/registry";

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
   * Sekme şeridi ÇİZİLMEYEN ama öğeyi etkin yapan ek yollar: sayfa kendi alt gezinmesini taşır (ör. İlan Kontrol
   * alt gezinmesindeki "Kapanış kayıpları" = /app/kayip-kacak) ya da sayfaya bir düğmeden gidilir (TV panosu).
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
        label: "Ana ekran",
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
        // Akıllı Listeler ve Tavsiyeler Müşteriler öğesinin sekmesidir (yollar değişmez; modül kapalıysa sekme gizlenir).
        href: "/app/musteriler",
        label: "Müşteriler",
        icon: ICONS.musteri,
        module: "customers",
        tabs: [
          { href: "/app/musteriler", label: "Müşteriler", icon: ICONS.musteri, module: "customers" },
          { href: "/app/akilli-listeler", label: "Akıllı Listeler", icon: ICONS.akilliListe, module: "customers", description: "Kimi aramalıyım? Risk, sıcak ve sessiz müşteri grupları", keywords: ["segment", "churn", "sıcak"] },
          { href: "/app/kayip-satis", label: "Riskli müşteriler", icon: ICONS.dusus, module: "customers", description: "Kaybedilme riski taşıyan müşteriler ve kayıp nedenleri", keywords: ["kayıp", "risk", "churn", "neden"] },
          { href: "/app/tavsiyeler", label: "Tavsiyeler", icon: ICONS.tavsiye, module: "customers", description: "Müşteri tavsiye bağlantıları ve referans zinciri", keywords: ["referans", "tavsiye"] },
          // Modül ayarı modülün içinde (yol sabit; aynı sayfa Ayarlar dizininden de açılır — tek form, iki giriş).
          { href: "/app/ayarlar/etiketler", label: "Etiketler", icon: ICONS.musteri, module: "customers", description: "Müşteri etiketlerini yeniden adlandır, birleştir ya da kaldır", keywords: ["etiket", "ayar"] },
        ],
        description: "Müşteri kartları, akıllı listeler, riskli müşteriler ve tavsiyeler",
        keywords: ["kişi", "alıcı", "malik", "mülk sahibi", "aday", "cari"],
        shortcut: "g m",
      },
      // Talepler sayfasının ikinci sekmesi "Eşleşme" (matching izniyle gizlenir); /app/eslestirme yönlendirir.
      {
        href: "/app/talepler",
        label: "Talepler",
        icon: ICONS.talep,
        module: "demands",
        description: "Alıcı ve kiracı talepleri, portföy eşleşmesi",
        keywords: ["lead", "aday", "istek", "başvuru", "eşleştirme", "eşleşme"],
        shortcut: "g t",
      },
      // İkinci sekme "Çağrı kaydı" (eski /app/arama, yönlendirir): iki sekme de `calls` modülünde.
      {
        href: "/app/gelen-kutusu",
        label: "Gelen Kutusu",
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
          { href: "/app/portfoyler/anahtarlar", label: "Anahtar Takibi", icon: ICONS.anahtarTakip, module: "properties", description: "Anahtar kimde, ne zaman teslim edildi", keywords: ["anahtar", "teslim"] },
          { href: "/app/portfoyler/sunumlar", label: "Sunumlar", icon: ICONS.sunum, module: "properties", description: "Müşteriye gönderilecek portföy sunumları", keywords: ["sunum", "paylaşım", "pdf"] },
          { href: "/app/ilan-havuzu", label: "Havuz ve Atama", icon: ICONS.ilanHavuzu, module: "properties", description: "Atanmamış ilanların uzmanlığa göre dağıtımı", keywords: ["havuz", "atama", "ata", "ilan ata", "dağıt", "uzmanlık"] },
          { href: "/app/ayarlar/filigran", label: "Filigran", icon: ICONS.portfoy, module: "settings", description: "İlan fotoğraflarına otomatik ofis filigranı", keywords: ["filigran", "logo", "fotoğraf", "ayar"] },
        ],
        description: "İlan ve portföy kayıtları, anahtar, sunum ve havuz",
        keywords: ["ilan", "mülk", "emlak", "gayrimenkul", "daire", "arsa", "konut"],
        shortcut: "g p",
      },
      // İlan Kontrol Merkezi: kayıp/kaçak ve portal doğrulama özeti (modül `portals`; yeni izin modülü yok).
      {
        href: "/app/ilan-kontrol",
        label: "İlan Kontrol",
        icon: ICONS.ilanKontrol,
        module: "portals",
        // Portal ilanları (teyit/yenileme/kapanış kaydı) İlan Kontrol'ün sekmesidir; aynı `portals` modülü, yol sabit.
        tabs: [
          { href: "/app/ilan-kontrol", label: "İlan Kontrol", icon: ICONS.ilanKontrol, module: "portals" },
          { href: "/app/portallar", label: "Portal ilanları", icon: ICONS.portal, module: "portals", description: "Portal ilanlarının teyit, yenileme ve kapanış kaydı", keywords: ["sahibinden", "hepsiemlak", "emlakjet", "portal", "teyit"] },
        ],
        description: "Portal yayın takibi, kayıp ve kaçak uyarıları, kapanış kayıpları",
        keywords: ["kayıp", "kaçak", "anomali", "sla", "yayın", "kaçan komisyon", "kapanış kaybı", "kalkan", "rakip"],
        // Kayıp-Kaçak Kalkanı İlan Kontrol alt gezinmesinin "Kapanış kayıpları" sekmesidir (tek menü girişi).
        matchPaths: ["/app/kayip-kacak"],
      },
      {
        href: "/app/kiralama",
        label: "Kiralama",
        icon: ICONS.anahtar,
        module: "rentals",
        // Kira artışı izin modülü `valuation` (kiralama `rentals`): sekme kendi modülüyle gizlenir/gösterilir.
        tabs: [
          { href: "/app/kiralama", label: "Kiralama", icon: ICONS.anahtar, module: "rentals" },
          { href: "/app/kira-artis", label: "Kira artışı", icon: ICONS.oran, module: "valuation", description: "TÜFE'ye göre yasal kira artışı hesabı", keywords: ["tüfe", "zam", "artış"] },
          // Aidat ayrı menü öğesi değildir: yönettiğiniz kiralık daire/sitelerin aidatı Kiralama'nın sekmesidir (yol sabit; kendi modülü expenses).
          { href: "/app/aidat", label: "Aidat & site", icon: ICONS.aidat, module: "expenses", description: "Yönettiğiniz kiralık dairelerin ve sitelerin aidatlarını, tahsilatlarını ve borçlarını takip edin", keywords: ["aidat", "ortak gider", "apartman", "site", "bina", "daire cari", "borç"] },
        ],
        description: "Kira sözleşmeleri, aylık tahakkuk, kira artışı ve site aidatları",
        keywords: ["kira", "kiracı", "tahakkuk", "depozito", "aidat", "site", "apartman"],
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
        label: "Açık Ev",
        icon: ICONS.acikEv,
        module: "open_house",
        description: "Açık ev etkinlikleri ve QR ile ziyaretçi kaydı",
        keywords: ["open house", "ziyaretçi", "etkinlik", "qr"],
      },
      {
        href: "/app/ag",
        label: "Ofis Ağı",
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
          { href: "/app/ayarlar/sozlesme-sablonlari", label: "Sözleşme şablonları", icon: ICONS.sozlesme, module: "settings", description: "Sözleşme şablonlarını ekle, düzenle, pasife al", keywords: ["şablon", "ayar"] },
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
          { href: "/app/onaylar", label: "Onaylar", icon: ICONS.onay, module: "commissions", description: "Komisyon ve indirim onay talepleri", keywords: ["onay", "approval", "bekleyen"] },
        ],
        description: "Komisyon defteri, tahsilat, kazanç ve onaylar",
        keywords: ["hakediş", "tahsilat", "cüzdan", "kazanç", "onay", "kdv"],
        shortcut: "g k",
      },
      {
        href: "/app/giderler",
        label: "Giderler",
        icon: ICONS.gider,
        module: "expenses",
        description: "Ofis giderleri ve kâr-zarar",
        keywords: ["masraf", "harcama", "fiş", "kar zarar"],
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
          { href: "/app/raporlar/memnuniyet", label: "Memnuniyet", icon: ICONS.memnuniyet, module: "reports", description: "Müşteri memnuniyet anketi sonuçları", keywords: ["nps", "memnuniyet"] },
          { href: "/app/anketler", label: "Anketler", icon: ICONS.anketor, module: "surveys", description: "Anketör kuyruğu, şablonlar ve sonuçlar", keywords: ["anket", "anketör"] },
          { href: "/app/raporlar/lead-hizi", label: "Aday hızı", icon: ICONS.leadHizi, module: "reports", description: "Adaya ilk dönüş süresi", keywords: ["hız", "dönüş süresi", "lead"] },
          { href: "/app/franchise", label: "Şube", icon: ICONS.sube, module: "reports", description: "Şube ve ofis bazlı karşılaştırma", keywords: ["franchise", "şube"] },
          { href: "/app/raporlar/kar-zarar", label: "Kâr / zarar", icon: ICONS.karZarar, module: "reports", description: "Komisyon, gider ve danışman payıyla aylık net sonuç", keywords: ["kâr", "zarar", "net", "gelir gider"] },
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
          { href: "/app/danisman-kpi", label: "Özet", icon: ICONS.kpi, module: "reports", description: "Arama, randevu, teklif ve anlaşma performansı", keywords: ["kpi", "performans", "danışman"] },
          { href: "/app/lig", label: "Lig", icon: ICONS.lig, module: "reports", description: "Sıralama, rozetler ve motivasyon panosu", keywords: ["lig", "sıralama", "rozet"] },
          { href: "/app/ekip/kiyas", label: "Kıyas", icon: ICONS.kiyas, module: "reports", description: "Danışman karnesi: dönüşüm, iş yükü, hedef", keywords: ["kıyas", "karşılaştır", "karne"] },
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
        label: "AI Asistan",
        icon: ICONS.ai,
        module: "dashboard",
        tabs: [
          { href: "/app/asistan", label: "AI Asistan", icon: ICONS.ai, module: "dashboard" },
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
        label: "Yabancıya Satış",
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
        // Ekip Merkezi: tek kabuk, mevcut sayfalar sekme olarak yeniden kullanılır
        // (Hedefler eskiden Performans başlığındaydı; yolu değişmedi).
        href: "/app/ekip",
        label: "Ekip Merkezi",
        icon: ICONS.ekip,
        module: "team",
        tabs: [
          { href: "/app/ekip", label: "Genel", icon: ICONS.ekip, module: "team" },
          // Kıyas / Danışman KPI / Lig sekmeleri "Ekip performansı" öğesine taşındı (Performans ve Raporlar).
          { href: "/app/hedefler", label: "Hedefler", icon: ICONS.hedef, module: "targets", description: "Aylık ciro ve anlaşma hedefleri", keywords: ["hedef", "kota", "target"] },
          { href: "/app/ekip/devir", label: "Devir / Atama", icon: ICONS.devir, module: "team", description: "Müşteri ve portföyleri danışmanlar arasında devret", keywords: ["devir", "atama", "transfer"] },
          { href: "/app/ekip/subeler", label: "Şubeler", icon: ICONS.ekip, module: "team", description: "Şube tanımları ve bölgeleri", keywords: ["şube", "branş"] },
          { href: "/app/ekip/takimlar", label: "Takımlar", icon: ICONS.ekip, module: "team", description: "Takımlar ve takım liderleri", keywords: ["takım", "lider"] },
        ],
        // Ekip Merkezi ekip modülü olanın girişidir; modülsüz rolde (danışman) yerine Performansım vardır.
        needsItemModule: true,
        description: "Danışmanlar, hedefler, devir, şube ve takımlar",
        keywords: ["danışman", "çalışan", "personel", "ekip", "şube", "takım", "izin"],
      },
      {
        href: "/app/ofis-merkezi",
        label: "Ofis Merkezi",
        icon: ICONS.ofisMerkezi,
        module: "office_center",
        description: "Danışman yönetimi, havuzdan atama, ofis ayar ve tanımları",
        keywords: ["atama", "tanım", "yönetim merkezi"],
      },
      {
        // Ayarlar kabuğu: Genel ayar sayfası + erişim yönetimi sekmeleri (yollar sabit, her sayfa kendi kapısını korur).
        href: "/app/ayarlar",
        label: "Ayarlar",
        icon: ICONS.ayar,
        module: "settings",
        tabs: [
          { href: "/app/ayarlar", label: "Genel", icon: ICONS.ayar, module: "settings" },
          { href: "/app/ayarlar/roller", label: "Roller", icon: ICONS.roller, module: "settings", description: "Rol izin matrisi ve kullanıcı istisnaları", keywords: ["rol", "izin", "yetki", "matris"] },
          { href: "/app/ayarlar/yetkilendirme", label: "Yetkilendirme", icon: ICONS.yetkilendirme, module: "settings", description: "Kapsamlar, istisnalar, denetim günlüğü", keywords: ["kapsam", "istisna", "yetkilendirme", "erişim"] },
          { href: "/app/ayarlar/moduller", label: "Modüller", icon: ICONS.moduller, module: "settings", description: "Kullanılmayan alanları kapat, menü sadeleşsin", keywords: ["modül", "aç kapa", "sadeleştir"] },
          { href: "/app/ayarlar/ozel-alanlar", label: "Özel alanlar", icon: ICONS.ozelAlan, module: "settings", description: "Müşteri, portföy, talep ve anlaşmaya ofise özel alanlar ekle", keywords: ["özel alan", "custom field", "alan ekle"] },
          { href: "/app/ayarlar/api-webhook", label: "API ve webhook", icon: ICONS.apiWebhook, module: "settings", description: "API anahtarı ve imzalı webhook olayları", keywords: ["api", "webhook", "entegrasyon"] },
          // Sayfa her üyeye açıktır (devralması istenen kişi onayı burada verir; bildirim buraya götürür); sekme ayar yetkisiyle görünür.
          { href: "/app/ayarlar/sahiplik-devri", label: "Sahiplik devri", icon: ICONS.sahiplik, module: "settings", description: "Ofis sahipliğini ekipten birine iki adımda devret", keywords: ["sahip", "devir", "devret", "ofis sahibi"] },
        ],
        description: "Ofis kimliği, roller, yetkilendirme, modüller ve entegrasyonlar",
        keywords: ["settings", "yapılandırma", "entegrasyon", "rol", "izin", "logo", "netgsm", "kurulum", "sihirbaz"],
      },
      {
        href: "/app/abonelik",
        label: "Abonelik",
        icon: ICONS.abonelik,
        module: "billing",
        description: "Paket, fatura, kontör ve hesap kredisi",
        keywords: ["fatura", "ödeme", "plan", "kontör", "kredi", "kart", "koltuk"],
      },
      {
        // Yardım ve Destek: tek menü öğesi; yardım merkezi + mevcut destek talepleri sekme.
        href: "/app/yardim",
        label: "Yardım",
        icon: ICONS.destek,
        module: "support",
        tabs: [
          { href: "/app/yardim", label: "Yardım", icon: ICONS.destek, module: "support" },
          { href: "/app/destek", label: "Destek talepleri", icon: ICONS.destek, module: "support", description: "EmlakSoft ekibine açılan destek talepleri", keywords: ["ticket", "destek", "talep"] },
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
        label: "Belge Merkezi",
        icon: ICONS.belge,
        module: "settings",
        description: "Ofis belgeleri, evrak linkleri ve şablonlar",
        keywords: ["dosya", "evrak", "döküman", "arşiv"],
      },
      {
        // Denetim kaydı + Ofis Kontrol Merkezi (danışman işlem akışı, uyarılar, onay kuralları) tek menü öğesi.
        href: "/app/denetim",
        label: "Denetim",
        icon: ICONS.denetim,
        module: "settings",
        tabs: [
          { href: "/app/denetim", label: "Denetim kaydı", icon: ICONS.denetim, module: "settings" },
          { href: "/app/ofis-kontrol", label: "Ofis Kontrol", icon: ICONS.denetim, module: "team", description: "Danışman işlem akışı, uyarılar ve onay kuralları", keywords: ["kontrol", "uyarı", "kural"] },
        ],
        description: "Kim ne zaman neyi değiştirdi; Ofis Kontrol Merkezi",
        keywords: ["audit", "log", "kayıt", "izleme", "geçmiş"],
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
 * Menüden kalkan ama yolu çalışmaya devam eden eski sayfalar (yer imleri):
 * eski yol → birleşik sayfa. Sayfa dosyası kendi yönlendirmesini yapar.
 */
export const NAV_ALIASES: Readonly<Record<string, string>> = {
  "/app/yatirim": "/app/hesaplayici?sekme=yatirim",
  "/app/arama": "/app/gelen-kutusu?sekme=cagri",
  "/app/eslestirme": "/app/talepler?sekme=eslesme",
};

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
  "/app/brifing": "Ana ekrana yönlendirir (içerik Bugün bloğunda)",
  "/app/hesabim": "Kullanıcı menüsünden (sağ üst) açılır; danışmanda 'Ben' merkezinin 'Profilim' sekmesi, komut paletinde aranabilir",
  "/app/hizli": "Sahada hızlı kayıt: üst çubuk 'Yeni' menüsü ve komut paleti eylemi",
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

/** Menü öğeleri, sekmeleri ve eski (yönlendirmeli) yollar: hiçbir sayfa kaybolmaz. */
export const ALL_NAV_HREFS: readonly string[] = [
  ...new Set([
    ...NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.tabs?.map((t) => t.href) ?? []), ...(i.matchPaths ?? [])])),
    ...Object.keys(NAV_ALIASES),
  ]),
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

/** Katalogda sekme çizilmeyen ek yollar (matchPaths) -> sahibi sayfa: Kapanış kayıpları İlan Kontrol'ü etkin yapar. */
const EXTRA_PATH_OWNER: ReadonlyMap<string, string> = new Map(
  NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => (i.matchPaths ?? []).map((m) => [m, i.tabs?.[0]?.href ?? i.href] as const))),
);

export type NavHub = {
  id: string;
  label: string;
  icon: NavIcon;
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

function buildHub(def: HubDef, accessible: readonly AppModule[], closed: readonly string[]): NavHub | null {
  const pages = def.pages.flatMap((ref) => {
    const info = PAGE_INDEX.get(ref.href);
    return info && pageVisible(info, accessible, closed, ref.ownModule) ? [publicPage(info, ref.label)] : [];
  });
  const first = pages[0];
  if (!first) return null;
  return { id: def.id, label: def.label, icon: ICONS[def.icon], href: first.href, pages };
}

/**
 * Rolün görünür menüsü (TEK hesap; masaüstü, çekmece, mobil çubuk, sekme şeridi ve testler aynı sonucu kullanır).
 * Merkezde izinli hiçbir sayfa yoksa merkez gizlenir.
 */
export function hubNav(accessible: readonly AppModule[], opts: { role?: string | null; closed?: readonly string[] } = {}): HubNavModel {
  const layout = navLayoutFor(opts.role);
  const closed = opts.closed ?? [];
  const build = (defs: readonly HubDef[]) => defs.flatMap((d) => buildHub(d, accessible, closed) ?? []);
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
  const owner = new Map<string, { hub: NavHub; dock: boolean }>();
  for (const hub of nav.hubs) for (const pg of hub.pages) if (!owner.has(pg.href)) owner.set(pg.href, { hub, dock: false });
  for (const hub of nav.dock) for (const pg of hub.pages) if (!owner.has(pg.href)) owner.set(pg.href, { hub, dock: true });
  const keys = new Map<string, string>([...owner.keys()].map((h) => [h, h]));
  for (const [extra, target] of EXTRA_PATH_OWNER) if (owner.has(target) && !keys.has(extra)) keys.set(extra, target);
  const toolHrefs = nav.tools.map((t) => t.href);
  const hit = findActiveNavigationHref(pathname, [...keys.keys(), ...toolHrefs], "/app");
  if (!hit) return { hub: null, pageHref: null, inDock: false, inTools: false };
  const pageHref = keys.get(hit);
  const found = pageHref ? owner.get(pageHref) : undefined;
  if (pageHref && found) return { hub: found.hub, pageHref, inDock: found.dock, inTools: false };
  return { hub: null, pageHref: hit, inDock: false, inTools: true };
}

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
