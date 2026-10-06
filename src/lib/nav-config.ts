import type { LucideIcon } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { findActiveNavigationHref } from "@/lib/navigation";
import type { AppModule } from "@/lib/permissions";
import { coreHrefsFor, isHiddenInSimple } from "@/lib/nav-roles";
import { featureForHref } from "@/lib/modules/registry";

/**
 * /app menüsünün TEK kaynağı. 55 düz link yerine 9 iş başlığı: kullanıcı önce
 * "ne yapıyorum" (bugün, müşteri, portföy, anlaşma…) seçer, sonra başlığın
 * içindeki sayfaya gider. Sayfa yolları DEĞİŞMEZ; hiçbir sayfa silinmedi, eski
 * bağlantılar ve yer imleri çalışır. Menüde görünmeyen alt sayfalar (ör.
 * /app/ayarlar/filigran, /app/ekip/izinler) bağlı oldukları öğenin içindedir
 * ve o öğe etkin görünür (en uzun yol eşleşmesi).
 *
 * Bilgi mimarisi (2026-10, bkz. docs/design/MENU_IA_2026_10.md):
 *  - Her başlık bir iş akışıdır; sıra = kullanım sıklığı. "İleri düzey/nadir" öğeler
 *    `advanced` ile işaretlenir ve yan menüde ince bir ayracın altında listelenir.
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
  /** true: sekmelerin kendi modülü yetse de öğenin kendi `module`ü yoksa öğe hiç görünmez. */
  needsItemModule?: boolean;
  /**
   * Sade görünümde çekirdek mi? "core" = en az bir rolün çekirdek menüsünde (rol eşlemesi
   * `nav-roles.ts`; uyum testi ikisini eşitler), "more" = yalnız "Daha fazla" altında.
   */
  tier: NavTier;
  /** Komut paletinde ve menü ipucunda (title) görünen tek cümlelik açıklama. ZORUNLU (sözleşme testi). */
  description: string;
  /** Yalnız arama eş anlamlıları ("lead", "excel"…); ekranda gösterilmez. */
  keywords?: readonly string[];
  /** İleri düzey / nadir kullanılan öğe: yan menüde bölüm ayracının altında listelenir. */
  advanced?: boolean;
  /** `g` önekli gezinme kısayolu (ör. "g m"); tek kaynak, keyboard-shortcuts.tsx ve palet buradan okur. */
  shortcut?: string;
};

export type NavTier = "core" | "more";

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
    description: "Günün özeti, randevular, görevler ve bildirimler.",
    items: [
      {
        href: "/app",
        label: "Ana ekran",
        icon: ICONS.dashboard,
        module: "dashboard",
        tier: "core",
        description: "Günün özeti, içgörüler ve hızlı eylemler",
        keywords: ["anasayfa", "pano", "özet", "brifing", "dashboard"],
        shortcut: "g h",
      },
      {
        href: "/app/randevular",
        label: "Randevular",
        icon: ICONS.randevu,
        module: "appointments",
        tier: "core",
        description: "Gösterim ve görüşme takvimi",
        keywords: ["takvim", "gösterim", "ajanda", "ziyaret"],
        shortcut: "g r",
      },
      {
        href: "/app/gorevler",
        label: "Görevler",
        icon: ICONS.gorev,
        module: "tasks",
        tier: "core",
        description: "Yapılacaklar, vadeler ve geciken işler",
        keywords: ["yapılacak", "todo", "hatırlatma", "vade"],
        shortcut: "g g",
      },
      {
        href: "/app/bildirimler",
        label: "Bildirimler",
        icon: ICONS.bildirim,
        module: "dashboard",
        tier: "more",
        description: "Tüm bildirimler ve ofis duyuruları",
        keywords: ["duyuru", "zil", "uyarı", "haber"],
      },
    ],
  },
  {
    id: "musteriler",
    title: "Müşteriler ve Talepler",
    icon: ICONS.baslikMusteri,
    description: "Müşteri kartları, talepler, eşleşme ve toplu veri girişi.",
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
          { href: "/app/tavsiyeler", label: "Tavsiyeler", icon: ICONS.tavsiye, module: "customers", description: "Müşteri tavsiye bağlantıları ve referans zinciri", keywords: ["referans", "tavsiye"] },
          // Modül ayarı modülün içinde (yol sabit; aynı sayfa Ayarlar dizininden de açılır — tek form, iki giriş).
          { href: "/app/ayarlar/etiketler", label: "Ayarlar", icon: ICONS.musteri, module: "customers", description: "Müşteri etiketlerini yeniden adlandır, birleştir ya da kaldır", keywords: ["etiket", "ayar"] },
        ],
        tier: "core",
        description: "Müşteri kartları, akıllı listeler ve tavsiyeler",
        keywords: ["kişi", "alıcı", "malik", "mülk sahibi", "aday", "cari"],
        shortcut: "g m",
      },
      // Talepler sayfasının ikinci sekmesi "Eşleşme" (matching izniyle gizlenir); /app/eslestirme yönlendirir.
      {
        href: "/app/talepler",
        label: "Talepler",
        icon: ICONS.talep,
        module: "demands",
        tier: "core",
        description: "Alıcı ve kiracı talepleri, portföy eşleşmesi",
        keywords: ["lead", "aday", "istek", "başvuru", "eşleştirme", "eşleşme"],
        shortcut: "g t",
      },
      // İçe aktarma bir EYLEM sayfasıdır: menü öğesi değil; Müşteriler/Portföyler başlığında "İçe aktar" düğmesi
      // ve komut paleti eylemi (HIDDEN_APP_PAGES gerekçesi).
    ],
  },
  {
    id: "portfoy",
    title: "Portföy ve İlanlar",
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
          { href: "/app/ilan-havuzu", label: "İlan Havuzu", icon: ICONS.ilanHavuzu, module: "properties", description: "Atanmamış ilanların uzmanlığa göre dağıtımı", keywords: ["havuz", "atama"] },
          { href: "/app/ayarlar/filigran", label: "Ayarlar", icon: ICONS.portfoy, module: "settings", description: "İlan fotoğraflarına otomatik ofis filigranı", keywords: ["filigran", "logo", "fotoğraf", "ayar"] },
        ],
        tier: "core",
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
        tier: "core",
        description: "Portal yayın takibi, kayıp ve kaçak uyarıları",
        keywords: ["kayıp", "kaçak", "anomali", "sla", "yayın"],
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
        ],
        tier: "more",
        description: "Kira sözleşmeleri, aylık tahakkuk ve kira artışı",
        keywords: ["kira", "kiracı", "tahakkuk", "depozito"],
      },
      {
        href: "/app/projeler",
        label: "Projeler",
        icon: ICONS.proje,
        module: "projects",
        tier: "more",
        description: "Proje ve daire stoğu, ödeme planı",
        keywords: ["inşaat", "stok", "blok", "proje satışı"],
      },
      {
        href: "/app/acik-ev",
        label: "Açık Ev",
        icon: ICONS.acikEv,
        module: "open_house",
        tier: "more",
        description: "Açık ev etkinlikleri ve QR ile ziyaretçi kaydı",
        keywords: ["open house", "ziyaretçi", "etkinlik", "qr"],
      },
      {
        href: "/app/portallar",
        label: "Portal ilanları",
        icon: ICONS.portal,
        module: "portals",
        tier: "more",
        advanced: true,
        description: "Portal ilanlarının teyit, yenileme ve kapanış kaydı",
        keywords: ["sahibinden", "hepsiemlak", "emlakjet", "portal", "teyit"],
      },
      {
        href: "/app/ag",
        label: "Ofisler Arası Ağ",
        icon: ICONS.ag,
        module: "network",
        tier: "more",
        advanced: true,
        description: "Başka ofislerle ilan ve talep paylaşımı, ortak satış",
        keywords: ["network", "ortak satış", "paylaşım", "ağ"],
      },
    ],
  },
  {
    id: "anlasmalar",
    title: "Anlaşmalar ve Sözleşmeler",
    icon: ICONS.baslikAnlasma,
    description: "Teklif, anlaşma hattı ve imzalı sözleşme.",
    items: [
      {
        // Kayıp nedenleri Anlaşmalar öğesinin sekmesidir; sekme kendi izniyle (müşteriler) gizlenir.
        href: "/app/anlasmalar",
        label: "Anlaşmalar",
        icon: ICONS.anlasma,
        module: "commissions",
        tabs: [
          { href: "/app/anlasmalar", label: "Anlaşmalar", icon: ICONS.anlasma, module: "commissions" },
          { href: "/app/kayip-satis", label: "Risk altındaki müşteriler", icon: ICONS.dusus, module: "customers", description: "Kaybedilme riski taşıyan müşteriler ve kayıp nedenleri", keywords: ["kayıp", "risk", "churn", "neden"] },
        ],
        needsItemModule: true,
        tier: "core",
        description: "Satış hattı, aşamalar ve risk altındaki müşteriler",
        keywords: ["deal", "satış hattı", "pipeline", "pano", "kanban", "aşama"],
        shortcut: "g a",
      },
      {
        href: "/app/teklifler",
        label: "Teklifler",
        icon: ICONS.teklif,
        module: "offers",
        tier: "more",
        description: "Teklif turları, karşı teklif ve kabul",
        keywords: ["offer", "pazarlık", "karşı teklif"],
      },
      {
        href: "/app/sozlesmeler",
        label: "Sözleşmeler",
        icon: ICONS.sozlesme,
        module: "contracts",
        tabs: [
          { href: "/app/sozlesmeler", label: "Sözleşmeler", icon: ICONS.sozlesme, module: "contracts" },
          { href: "/app/ayarlar/sozlesme-sablonlari", label: "Ayarlar", icon: ICONS.sozlesme, module: "settings", description: "Sözleşme şablonlarını ekle, düzenle, pasife al", keywords: ["şablon", "ayar"] },
        ],
        tier: "more",
        description: "Şablondan sözleşme ve SMS onaylı e-imza",
        keywords: ["e-imza", "imza", "kontrat", "şablon"],
      },
    ],
  },
  {
    id: "iletisim",
    title: "İletişim ve Pazarlama",
    icon: ICONS.baslikIletisim,
    description: "Gelen mesajlar, çağrı kaydı ve toplu kampanyalar.",
    items: [
      // İkinci sekme "Çağrı kaydı" (eski /app/arama, yönlendirir): iki sekme de `calls` modülünde.
      {
        href: "/app/gelen-kutusu",
        label: "Gelen Kutusu",
        icon: ICONS.gelenKutusu,
        module: "calls",
        tier: "core",
        description: "WhatsApp, SMS, form başvuruları ve çağrı kaydı",
        keywords: ["whatsapp", "sms", "mesaj", "çağrı", "arama", "telefon", "başvuru", "inbox"],
      },
      {
        href: "/app/kampanyalar",
        label: "Kampanyalar",
        icon: ICONS.mesaj,
        module: "campaigns",
        tabs: [
          { href: "/app/kampanyalar", label: "Kampanyalar", icon: ICONS.mesaj, module: "campaigns" },
          { href: "/app/ayarlar/mesaj-sablonlari", label: "Ayarlar", icon: ICONS.mesaj, module: "settings", description: "WhatsApp ve SMS için hazır mesaj şablonları", keywords: ["şablon", "mesaj", "ayar"] },
        ],
        tier: "more",
        description: "İYS uyumlu toplu SMS ve WhatsApp gönderimi",
        keywords: ["toplu mesaj", "iys", "pazarlama", "bülten"],
      },
    ],
  },
  {
    id: "finans",
    title: "Finans",
    icon: ICONS.baslikFinans,
    description: "Komisyon defteri, kazanç, onaylar, gider ve aidat.",
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
        tier: "core",
        description: "Komisyon defteri, tahsilat, kazanç ve onaylar",
        keywords: ["hakediş", "tahsilat", "cüzdan", "kazanç", "onay", "kdv"],
        shortcut: "g k",
      },
      {
        href: "/app/giderler",
        label: "Giderler",
        icon: ICONS.gider,
        module: "expenses",
        tier: "core",
        description: "Ofis giderleri ve kâr-zarar",
        keywords: ["masraf", "harcama", "fiş", "kar zarar"],
      },
      {
        href: "/app/aidat",
        label: "Aidat",
        icon: ICONS.aidat,
        module: "expenses",
        tier: "core",
        description: "Portföy aidat ve ortak gider takibi",
        keywords: ["ortak gider", "apartman", "site"],
      },
    ],
  },
  {
    id: "performans",
    title: "Performans ve Raporlar",
    icon: ICONS.baslikPerformans,
    description: "Kişisel karne, ofis raporları ve kaçak takibi.",
    items: [
      // Kişinin kendi karnesi, hedefi ve kazancı (danışman rolünde Ekip Merkezi yerine bu giriş vardır).
      {
        href: "/app/performansim",
        label: "Performansım",
        icon: ICONS.rozet,
        module: "dashboard",
        tier: "core",
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
        ],
        tier: "core",
        description: "Ofis, bölge, talep-arz, memnuniyet, anket ve şube raporları",
        keywords: ["analiz", "istatistik", "rapor", "bölge", "grafik"],
      },
      {
        href: "/app/kayip-kacak",
        label: "Kaçan komisyonlar",
        icon: ICONS.alarm,
        module: "leak",
        tier: "more",
        description: "Portal ilanından rakibe kapanan satışlar ve kaçan komisyon",
        keywords: ["kayıp kaçak", "kalkan", "rakip", "leak"],
      },
      {
        href: "/app/pano-tv",
        label: "Ofis Panosu (TV)",
        icon: ICONS.panoTv,
        module: "reports",
        tier: "more",
        advanced: true,
        description: "Ofis ekranı için canlı skor panosu",
        keywords: ["tv", "ekran", "pano", "lig"],
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
        tier: "core",
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
        tier: "more",
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
          { href: "/app/ayarlar/ai-kullanim", label: "Ayarlar", icon: ICONS.ai, module: "settings", description: "Aylık AI kredisi, kalan hak ve kişi bazında kullanım", keywords: ["kredi", "kota", "ai", "ayar"] },
        ],
        tier: "more",
        description: "Ofis verinizle sohbet eden yardımcı",
        keywords: ["yapay zeka", "sohbet", "chat", "asistan", "soru"],
      },
      {
        href: "/app/mahalle-notlari",
        label: "Mahalle notları",
        icon: ICONS.mahalleNotu,
        module: "properties",
        tier: "more",
        description: "Ofis içi saha notları: ulaşım, okul, gürültü, yatırım",
        keywords: ["saha", "bölge notu", "semt", "mahalle"],
      },
      {
        href: "/app/yabanci-satis",
        label: "Yabancıya Satış",
        icon: ICONS.yabanciSatis,
        module: "properties",
        tier: "more",
        advanced: true,
        description: "Yabancı alıcı için belge ve süreç kontrol listesi",
        keywords: ["vatandaşlık", "yabancı", "foreign", "döviz"],
      },
    ],
  },
  {
    id: "ofis",
    title: "Ofis ve Ayarlar",
    icon: ICONS.baslikOfis,
    description: "Ekip, ofis yönetimi, abonelik, yardım, uyum ve yapılandırma.",
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
          // Ekip performansı sekmeleri (eski Performans başlığındaki "Ekip performansı" girişi buraya birleşti).
          { href: "/app/ekip/kiyas", label: "Kıyas", icon: ICONS.kiyas, module: "reports", description: "Danışman karnesi: dönüşüm, iş yükü, hedef", keywords: ["kıyas", "karşılaştır"] },
          { href: "/app/danisman-kpi", label: "Danışman KPI", icon: ICONS.kpi, module: "reports", description: "Arama, randevu, teklif ve anlaşma performansı", keywords: ["kpi", "performans"] },
          { href: "/app/lig", label: "Ekip Ligi", icon: ICONS.lig, module: "reports", description: "Sıralama, rozetler ve motivasyon panosu", keywords: ["lig", "sıralama", "rozet"] },
          { href: "/app/hedefler", label: "Hedefler", icon: ICONS.hedef, module: "targets", description: "Aylık ciro ve anlaşma hedefleri", keywords: ["hedef", "kota", "target"] },
          { href: "/app/ekip/devir", label: "Devir / Atama", icon: ICONS.devir, module: "team", description: "Müşteri ve portföyleri danışmanlar arasında devret", keywords: ["devir", "atama", "transfer"] },
          { href: "/app/ekip/subeler", label: "Şubeler", icon: ICONS.ekip, module: "team", description: "Şube tanımları ve bölgeleri", keywords: ["şube", "branş"] },
          { href: "/app/ekip/takimlar", label: "Takımlar", icon: ICONS.ekip, module: "team", description: "Takımlar ve takım liderleri", keywords: ["takım", "lider"] },
        ],
        // Ekip Merkezi ekip modülü olanın girişidir; modülsüz rolde (danışman) yerine Performansım vardır.
        needsItemModule: true,
        tier: "core",
        description: "Danışmanlar, kıyas, KPI, lig, hedefler, şube ve takımlar",
        keywords: ["danışman", "çalışan", "personel", "ekip", "şube", "takım", "izin"],
      },
      {
        href: "/app/ofis-merkezi",
        label: "Ofis Merkezi",
        icon: ICONS.ofisMerkezi,
        module: "office_center",
        tier: "more",
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
          // Sayfa her üyeye açıktır (devralması istenen kişi onayı burada verir; bildirim buraya götürür); sekme ayar yetkisiyle görünür.
          { href: "/app/ayarlar/sahiplik-devri", label: "Sahiplik devri", icon: ICONS.sahiplik, module: "settings", description: "Ofis sahipliğini ekipten birine iki adımda devret", keywords: ["sahip", "devir", "devret", "ofis sahibi"] },
        ],
        tier: "more",
        description: "Ofis kimliği, roller, yetkilendirme, modüller ve entegrasyonlar",
        keywords: ["settings", "yapılandırma", "entegrasyon", "rol", "izin", "logo", "netgsm", "kurulum", "sihirbaz"],
      },
      {
        href: "/app/abonelik",
        label: "Abonelik ve paket",
        icon: ICONS.abonelik,
        module: "billing",
        tier: "core",
        description: "Paket, fatura, kontör ve hesap kredisi",
        keywords: ["fatura", "ödeme", "plan", "kontör", "kredi", "kart", "koltuk"],
      },
      {
        // Yardım ve Destek: tek menü öğesi; yardım merkezi + mevcut destek talepleri sekme.
        href: "/app/yardim",
        label: "Yardım ve Destek",
        icon: ICONS.destek,
        module: "support",
        tier: "core",
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
        tier: "more",
        advanced: true,
        description: "Tetikleyicili kurallar ve iş akışları",
        keywords: ["kural", "workflow", "tetikleyici", "otomatik"],
      },
      {
        href: "/app/uyum",
        label: "Uyum",
        icon: ICONS.uyum,
        module: "compliance",
        tier: "more",
        advanced: true,
        description: "KVKK, İYS izinleri, yetki belgesi ve denetim dosyası",
        keywords: ["kvkk", "iys", "yasal", "eids", "izin", "silme talebi"],
      },
      {
        href: "/app/belgeler",
        label: "Belge Merkezi",
        icon: ICONS.belge,
        module: "settings",
        tier: "more",
        advanced: true,
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
        tier: "more",
        advanced: true,
        description: "Kim ne zaman neyi değiştirdi; Ofis Kontrol Merkezi",
        keywords: ["audit", "log", "kayıt", "izleme", "geçmiş"],
      },
      {
        href: "/app/buyume",
        label: "Davet et ve kazan",
        icon: ICONS.davet,
        module: "settings",
        tier: "more",
        advanced: true,
        description: "Meslektaş davet et, hesap kredisi kazan",
        keywords: ["referans", "davet", "ödül", "arkadaş", "büyüme"],
      },
    ],
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
  "/app/baslangic": "Kurulum sihirbazı bir EYLEM akışıdır: ana ekran kurulum şeridi, Ayarlar dizini kartı ve komut paleti eylemi",
  "/app/brifing": "Ana ekrana yönlendirir (içerik Bugün bloğunda)",
  "/app/hesabim": "Kullanıcı menüsünden (sağ üst) açılır",
  "/app/hizli": "Sahada hızlı kayıt: üst çubuk 'Yeni' menüsü ve komut paleti eylemi",
  "/app/hos-geldin": "Danışman ilk giriş karşılaması; koşul sağlanmazsa ana ekrana yönlendirir",
  "/app/ice-aktarma": "Toplu yükleme bir EYLEM sayfasıdır: Müşteriler/Portföyler başlığındaki 'İçe aktar' düğmesi ve komut paleti eylemi",
  "/app/modul-kapali": "Kapalı modül bilgilendirme sayfası (modül kapısı yönlendirir)",
  "/app/paket": "Paket yükseltme sayfası (kilitli sayfadan ve Abonelik'ten ulaşılır)",
};

/**
 * Mobil alt sekme çubuğu: 4 ana iş başlığı + "Daha fazla" (çekmece). Her sekme başlığın
 * ilk görünen sayfasına gider; başlık yetkisiz/kapalıysa sekme çıkmaz.
 */
export const MOBILE_TAB_SECTIONS: readonly { id: string; label: string }[] = [
  { id: "bugun", label: "Bugün" },
  { id: "musteriler", label: "Müşteriler" },
  { id: "portfoy", label: "Portföy" },
  { id: "anlasmalar", label: "Anlaşmalar" },
];

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

/** "full": tüm yetkili sayfalar. "simple": yalnız rolün çekirdek sayfaları (gerisi `moreSections`). */
export type NavMode = "simple" | "full";
export type NavViewOptions = {
  mode?: NavMode;
  role?: string | null;
  /** Ofisin kapattığı modül anahtarları (src/lib/modules): menüde ve sekmelerde görünmez. */
  closed?: readonly string[];
};

/**
 * Erişilebilir modüllere göre görünen başlıklar; her başlığın girişi ilk görünen sayfasıdır.
 * `mode: "simple"` yalnız GÖRÜNÜRLÜĞÜ daraltır (yetki matrisi aynı): rolün çekirdek öğeleri kalır.
 */
export function visibleSections(accessible: readonly AppModule[], opts: NavViewOptions = {}): VisibleSection[] {
  const core = opts.mode === "simple" ? coreHrefsFor(opts.role) : null;
  return NAV_SECTIONS.map((section) => {
    const items = section.items.flatMap((item) =>
      core && !core.has(item.href) ? [] : (visibleItem(item, accessible, opts.closed) ?? []),
    );
    return { ...section, items, href: items[0]?.href ?? "/app" };
  }).filter((section) => section.items.length > 0);
}

/**
 * Sade görünümde "Daha fazla" altına inen yetkili öğeler (çekirdek dışı). Yönetici olmayan rollerde
 * yönetim sayfaları (Ayarlar, Otomasyon…) burada da yer almaz; tam görünümde ve doğrudan adreste durur.
 */
export function moreSections(
  accessible: readonly AppModule[],
  opts: { role?: string | null; closed?: readonly string[] } = {},
): VisibleSection[] {
  const core = coreHrefsFor(opts.role);
  return NAV_SECTIONS.map((section) => {
    const items = section.items.flatMap((item) =>
      core.has(item.href) || isHiddenInSimple(opts.role, item.href) ? [] : (visibleItem(item, accessible, opts.closed) ?? []),
    );
    return { ...section, items, href: items[0]?.href ?? "/app" };
  }).filter((section) => section.items.length > 0);
}

/** Menü öğeleri, sekmeleri ve eski (yönlendirmeli) yollar: hiçbir sayfa kaybolmaz. */
export const ALL_NAV_HREFS: readonly string[] = [
  ...new Set([
    ...NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.tabs?.map((t) => t.href) ?? [])])),
    ...Object.keys(NAV_ALIASES),
  ]),
];

/** Komut paleti arama metni: etiket + açıklama + eş anlamlılar (eş anlamlılar ekranda görünmez). */
export function navSearchText(entry: { label: string; description?: string; keywords?: readonly string[] }): string {
  return [entry.label, entry.description ?? "", ...(entry.keywords ?? [])].join(" ");
}

/** Yola göre etkin başlık ve öğe (en uzun yol eşleşmesi). */
export function resolveActiveNav(
  pathname: string,
  sections: readonly NavSection[],
): { section: NavSection | null; href: string | null } {
  // Sekme yolları, sahibi olan menü öğesini etkin yapar.
  const owner = new Map<string, string>();
  for (const item of sections.flatMap((s) => s.items)) {
    owner.set(item.href, item.href);
    for (const tab of item.tabs ?? []) owner.set(tab.href, item.href);
  }
  const hit = findActiveNavigationHref(pathname, [...owner.keys()], "/app");
  const href = hit ? (owner.get(hit) ?? null) : null;
  if (!href) return { section: null, href: null };
  const section = sections.find((s) => s.items.some((i) => i.href === href)) ?? null;
  return { section, href };
}
