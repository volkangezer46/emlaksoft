import {
  Activity,
  Bell,
  Bot,
  Building2,
  ClipboardCheck,
  CreditCard,
  Coins,
  Flag,
  Database,
  Globe,
  HeartPulse,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutList,
  LifeBuoy,
  Lightbulb,
  Link2,
  ListChecks,
  MapPin,
  Megaphone,
  MessageSquareText,
  Plug,
  Radar,
  Receipt,
  Rocket,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sprout,
  Users,
  Wallet,
  BarChart3,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import type { PlatformModule } from "@/lib/platform-access";

/**
 * /admin MENÜSÜ — TEK KAYNAK (yan menü, mobil çekmece, komut paleti ve bölüm sekmeleri buradan beslenir).
 *
 * Bilgi mimarisi (sahip kararı 2026-10-16: "herşey full adminden yönetilebilir, menüler alt menüler olsun"): dokuz iş
 * grubu (Genel bakış · Ofisler · Gelir & abonelik · Destek · İçerik & SEO · Güvenlik & veri · Sistem · Yapay
 * zeka & entegrasyon · Yönetim; genişleme planı docs/design/ADMIN_GENISLEME_2026-10.md). Grup = yan menüde satır içi açılır alan (akordeon; üst üste binen açılır pencere yok),
 * öğe = grubun alt menü satırı. Her admin sayfası bir öğeden, öğenin sekmesinden ya da ayrıntı/eylem yolu olarak sahibi
 * öğeden erişilir (yetim sayfa yok; `nav-coverage.test.ts`).
 *  - Menü öğesi = bir İŞ ALANI. "Yeni / oluştur / ekle" türü eylemler ve tek kaydın ayrıntısı menüde ayrı satır OLMAZ:
 *    listenin içinde birincil düğme (ör. Ofisler > "+ Yeni ofis") ya da komut paletinde (`palette`).
 *  - `match`: öğeyi aktif yapan ek yol önekleri; `exclude`: kendi öğesi olan alt bölümler (ör. Talepler > KVKK).
 *  - `?sekme=` taşıyan öğe (Entegrasyonlar = /admin/sistem?sekme=entegrasyonlar) yalnız o sekmede etkindir.
 *  - `tabs`: bölümün sayfa sekmeleri; `AdminSectionTabs` kabukta otomatik çizer. Yan menü sekmeleri TEKRAR ETMEZ: sekmeli
 *    öğe yalnız ok ve etkin vurgusu taşır. Sayfa içi ikinci seviye `?sekme=` ile sayfanın kendi şeridindedir.
 *  - `when`: modül dışı koşul (ör. kupon şeması); kabuk `AdminNavConditions` ile verir.
 *  - `dock`: yan menünün alt sabit bölümünde çizilir (Ayarlar); grup listesinde tekrar edilmez.
 *  - Görünürlük: `modules` listesinden en az biri rolde açıksa (sayfa kapısı ayrıca `requirePlatformModule`).
 *  - Menü yönetimi (/admin/ayarlar/menu) grupları gizleyip sıralayabilir (`AdminNavOverrides`); yalnız GÖRÜNÜRLÜK,
 *    yetki vermez. Genel bakış ve Yönetim grupları gizlenemez (ekran kilitlenmesin).
 */

/** Rozet anahtarları; sayılar `src/lib/admin-badges.ts` (önbellekli HEAD sayımları). */
export type AdminBadgeKey = "tickets" | "risk" | "approvals" | "payments" | "kvkk";

/** Sayaç rengi kuralı: kırmızı = gecikmiş/başarısız, turuncu = karar bekliyor, gri = bilgi. */
export const ADMIN_BADGE_TONE: Readonly<Record<AdminBadgeKey, "danger" | "warn" | "info">> = {
  risk: "danger",
  payments: "danger",
  approvals: "warn",
  tickets: "warn",
  kvkk: "warn",
};

/** Rozetin ekran okuyucu metni ("3 gecikmiş fatura"). */
export const ADMIN_BADGE_LABEL: Readonly<Record<AdminBadgeKey, string>> = {
  risk: "riskli ofis",
  payments: "vadesi geçmiş fatura",
  approvals: "onay bekleyen işlem",
  tickets: "açık talep",
  kvkk: "açık KVKK başvurusu",
};

export type AdminNavLink = {
  href: string;
  label: string;
  description: string;
  modules: readonly PlatformModule[];
  /** Sekmenin alt sayfaları: sekme etkinken şeridin İKİNCİ satırında çizilir (ör. Hız > Genel · Saha · Laboratuvar). */
  children?: readonly AdminNavLink[];
  /** Sekmeyi her zaman "Diğer ▾" altına koy (5 görünür sekme kuralından bağımsız). */
  overflow?: boolean;
  /** Ek görünürlük koşulu (ör. kupon şeması kurulu değilse Kuponlar sekmesi çizilmez); bkz. `AdminNavConditions`. */
  when?: AdminNavCondition;
};

/** Modül dışı görünürlük koşulları: kabuk (sunucu) hesaplar, sekme şeridine verir. Verilmeyen koşul sağlanmış sayılır. */
export type AdminNavCondition = "coupons";
export type AdminNavConditions = Partial<Record<AdminNavCondition, boolean>>;

/** Bölüm sekmesi (sekme şeridi ve komut paleti). */
export type NavTab = AdminNavLink;

export type AdminNavItem = AdminNavLink & {
  icon: LucideIcon;
  /** Mobil alt çubukta dar yuvaya sığan kısa ad (tam ad `aria-label`/`title` olarak kalır). */
  short?: string;
  badgeKey?: AdminBadgeKey;
  /** Mobil alt çubukta SABİT yuva (rol görüyorsa); bkz. `adminMobileTabs`. */
  mobileTab?: boolean;
  /** Yan menünün alt sabit bölümünde çizilir (grup listesinde değil). */
  dock?: boolean;
  match?: readonly string[];
  /** Aktif sayılmayacak alt yollar (ör. ayrı öğesi olan bir alt bölüm). */
  exclude?: readonly string[];
  tabs?: readonly AdminNavLink[];
  palette?: readonly AdminNavLink[];
};

export type AdminNavSection = {
  id: string;
  title: string;
  items: readonly AdminNavItem[];
  /** Menü yönetiminden gizlenemez (Genel bakış, Yönetim). */
  required?: boolean;
};

/** Menü yönetimi (platform ayarı) admin yan menüsü kısmı: seyrek fark; bilinmeyen grup kimliği yok sayılır. */
export type AdminNavOverrides = { hiddenGroups?: readonly string[]; groupOrder?: readonly string[] };

const L = (href: string, label: string, description: string, modules: readonly PlatformModule[], extra?: Pick<AdminNavLink, "children" | "overflow" | "when">): AdminNavLink => ({ href, label, description, modules, ...extra });

const SITE_ALL: readonly PlatformModule[] = ["sitecontent", "sitemenu", "seo", "marka", "reklam"];

export const ADMIN_NAV: readonly AdminNavSection[] = [
  {
    id: "genel",
    title: "Genel bakış",
    required: true,
    items: [
      {
        href: "/admin", mobileTab: true,
        label: "Kontrol paneli",
        short: "Panel",
        description: "Platform durumu, göstergeler ve dikkat gerektirenler",
        icon: LayoutDashboard,
        modules: ["dashboard"],
      },
      {
        href: "/admin/raporlar",
        label: "Raporlar",
        description: "Gelir, büyüme, iptal ve kullanım analizi; rapor merkezi",
        icon: BarChart3,
        modules: ["reports"],
        tabs: [
          L("/admin/raporlar", "Raporlar", "Platform analizi: gelir, birim ekonomisi, büyüme, iptal, modül ve AI kullanımı", ["reports"]),
          L("/admin/raporlar?sekme=merkez", "Rapor merkezi", "Dosya çıktısı (Excel, PDF), kayıtlı görünümler ve e-posta abonelikleri", ["reports"]),
        ],
      },
      // DG1 dört göz kuyruğu: kritik işlem (iade, kredi, ofis kapatma, rol) yapabilen herkes kendi talebini, onay yetkilisi bekleyenleri görür.
      { href: "/admin/onaylar", label: "Onaylar", description: "Dört göz onayı bekleyen kritik işlemler", icon: ClipboardCheck, modules: ["billing", "tenants", "personel"], badgeKey: "approvals" },
      { href: "/admin/bildirimler", label: "Bildirimler", description: "Platform bildirim kutusu: uyarılar, talepler ve sistem olayları", icon: Bell, modules: ["dashboard"] },
    ],
  },
  {
    id: "ofisler",
    title: "Ofisler",
    items: [
      {
        href: "/admin/tenants", mobileTab: true,
        label: "Ofisler",
        description: "Ofis envanteri, deneme, risk, abonelik durumu ve Ofis 360",
        icon: Building2,
        modules: ["tenants"],
        exclude: ["/admin/tenants/kurulum"],
        badgeKey: "risk",
        palette: [L("/admin/tenants/yeni", "Yeni ofis aç", "Ofis aç ve sahibine erişim ver", ["tenants"]), L("/admin/tenants?durum=trial", "Denemedeki ofisler", "Self-servis deneme hunisi", ["tenants"]), L("/admin/tenants?deneme=bitiyor", "Denemesi bitmek üzere olan ofisler", "7 gün içinde biten denemeler", ["tenants"])],
      },
      // Genişleme 2026-10: gece sağlık skorunun (tenant_health_daily) platform görünümü: düşenler, yeni riskliler, neden.
      { href: "/admin/ofis-sagligi", label: "Sağlık ve risk", description: "Sağlık skoru: düşenler, yeni riskliler ve nedeni", icon: HeartPulse, modules: ["tenants"] },
      // SN5: ofis bazında kurulum ilerlemesi (takılan adım süzgeci) + ürün turu ve kurulum adımları düzenleyicisi.
      { href: "/admin/tenants/kurulum", label: "Kurulum ve aktivasyon", description: "Kurulum ilerlemesi, ürün turu ve kurulum adımları", icon: Rocket, modules: ["sales"] },
      { href: "/admin/members", label: "Üyeler", description: "Ofis kullanıcıları ve hesap durumu", icon: Users, modules: ["members"] },
      // PA-2: platform personeli iş kuyruğu (bana atanan / atanmamış / geciken görevler + sorumlu olduğum ofisler).
      { href: "/admin/gorevler", label: "Görevler", description: "Takip görevleri, başarı kuralları ve ofislerim", icon: ListChecks, modules: ["tenants"] },
    ],
  },
  {
    id: "gelir",
    title: "Gelir & abonelik",
    items: [
      {
        href: "/admin/billing",
        label: "Abonelikler",
        description: "MRR, faturalar, planlar, kuponlar ve fatura defteri",
        icon: CreditCard,
        modules: ["billing"],
        exclude: ["/admin/billing/tahsilat", "/admin/billing/muhasebe", "/admin/billing/kanal-roi"],
        // Kuponlar yalnız kupon şeması kuruluysa (`when`).
        tabs: [
          L("/admin/billing", "Genel", "MRR, faturalar ve abonelik hareketleri", ["billing"]),
          L("/admin/billing/planlar", "Planlar", "Paket fiyatları, koltuk ve sınırlar", ["billing"]),
          L("/admin/billing/kuponlar", "Kuponlar", "İndirim kuponları", ["billing"], { when: "coupons" }),
          L("/admin/billing/defter", "Fatura defteri", "Tüm faturalar", ["billing"]),
        ],
      },
      { href: "/admin/billing/tahsilat", label: "Tahsilat", description: "Gecikmiş ödemeler, yaşlandırma, hatırlatma ve kurtarılan gelir", icon: Wallet, modules: ["billing"], badgeKey: "payments" },
      {
        href: "/admin/billing/muhasebe",
        label: "Muhasebe ve ROI",
        description: "Dönem geliri, KDV, ofis finansı ve kanal ROI",
        icon: Scale,
        modules: ["billing"],
        match: ["/admin/billing/kanal-roi"],
        tabs: [
          L("/admin/billing/muhasebe", "Muhasebe", "Dönem geliri, KDV ve ofis bazında finans", ["billing"]),
          L("/admin/billing/kanal-roi", "Kanal ROI", "Kanal bazında harcama, gelir, CAC ve geri ödeme", ["billing"]),
        ],
      },
      { href: "/admin/analiz-tarifesi", label: "Kullanım ve krediler", description: "Analiz tarifesi, paketler, hoş geldin bakiyesi ve ofis bakiyeleri", icon: Coins, modules: ["billing"] },
      { href: "/admin/ortaklik", label: "Ortaklık ve davet", description: "Davet ve ortak programı: başvurular, ödemeler ve program ayarları", icon: Sprout, modules: ["sales"] },
    ],
  },
  {
    id: "destek",
    title: "Destek",
    items: [
      {
        href: "/admin/tickets", mobileTab: true,
        label: "Talepler",
        description: "Destek kuyruğu, hazır yanıtlar, raporlar ve ayarlar",
        icon: LifeBuoy,
        modules: ["tickets"],
        badgeKey: "tickets",
        exclude: ["/admin/tickets/kvkk", "/admin/tickets/yardim", "/admin/tickets/oneriler"],
        tabs: [
          L("/admin/tickets", "Talepler", "Destek kuyruğu ve yanıt süreleri", ["tickets"]),
          L("/admin/tickets/makrolar", "Hazır yanıtlar", "Talep yanıtlarında kullanılan hazır metinler", ["tickets"]),
          L("/admin/tickets/raporlar", "Raporlar", "Yanıt süreleri, hacim ve memnuniyet", ["tickets"]),
          L("/admin/tickets/ayarlar", "Ayarlar", "Yanıt süresi hedefleri, otomasyon ve KVKK ayarları", ["tickets"]),
        ],
        palette: [L("/admin/tickets/yeni", "Yeni destek talebi", "Ofis adına talep aç", ["tickets"])],
      },
      { href: "/admin/tickets/yardim", label: "Yardım merkezi", description: "Yardım makaleleri, aramalar ve geri bildirim", icon: BookOpen, modules: ["sitecontent"] },
      { href: "/admin/tickets/oneriler", label: "Öneri panosu", description: "Ofislerin özellik önerileri, oylar ve durumu", icon: Lightbulb, modules: ["tickets"] },
      {
        href: "/admin/duyuru",
        label: "Toplu duyuru",
        description: "Duyuru, banner, Yenilikler ve NPS anketi",
        icon: Megaphone,
        modules: ["broadcast"],
        palette: [L("/admin/duyuru?sekme=nps", "NPS anketi", "Ürün içi memnuniyet anketi ve sonuçları", ["broadcast"])],
      },
    ],
  },
  {
    id: "icerik",
    title: "İçerik & SEO",
    items: [
      {
        href: "/admin/site",
        label: "Site ve içerik",
        short: "Site",
        description: "Büyüme kokpiti, içerik, site menüsü, marka, medya ve rehber",
        icon: Globe,
        // Sayfa kapısı bu listedir (site/page.tsx SITE_MODULES): bölümün herhangi bir modülü olan genel bakışı görür.
        modules: SITE_ALL,
        exclude: ["/admin/site/seo", "/admin/site/hiz", "/admin/site/reklam", "/admin/site/baglantilar"],
        // Sekmenin modülü, açtığı sayfanın kapısıyla (requirePlatformModule) AYNIDIR: görünen sekme her zaman açılır.
        tabs: [
          L("/admin/site", "Genel bakış", "Büyüme kokpiti: Site notu, öneri kuyruğu, Otopilot ve Yayın masası", SITE_ALL),
          L("/admin/site/sayfalar", "İçerik", "Ana sayfa metinleri, fiyatlar ve özel sayfalar", ["sitecontent"]),
          L("/admin/site/menu", "Site menüsü", "Menü, alt bilgi, duyuru şeridi", ["sitemenu"]),
          L("/admin/site/marka", "Marka", "Logo ve favicon", ["marka"]),
          L("/admin/site/medya", "Medya", "Görsel kitaplığı ve görsel bütçesi", ["sitecontent"]),
          L("/admin/site/rehber", "Rehber", "Rehber (blog) yazıları: taslak, yayın ve sürümler", ["sitecontent"]),
        ],
      },
      {
        href: "/admin/site/seo",
        label: "SEO ve hız",
        description: "Sitemap, robot, arama performansı ve hız ölçümleri",
        icon: Search,
        modules: ["seo", "sitecontent"],
        match: ["/admin/site/hiz"],
        tabs: [
          L("/admin/site/seo", "SEO", "Arama motoru, sitemap, robot ve arama performansı", ["seo"]),
          L("/admin/site/hiz", "Hız", "Statik sayfalar, hız bütçesi, saha ve laboratuvar ölçümleri", ["sitecontent"], {
            children: [
              L("/admin/site/hiz", "Genel", "Statik sunum ve hız bütçesi", ["sitecontent"]),
              L("/admin/site/hiz/saha", "Saha", "Gerçek ziyaretçi hız ölçümleri (Core Web Vitals)", ["sitecontent"]),
              L("/admin/site/hiz/lab", "Laboratuvar", "PageSpeed laboratuvar koşuları", ["sitecontent"]),
            ],
          }),
        ],
      },
      {
        href: "/admin/site/reklam",
        label: "Reklam ve Google",
        description: "Ziyaretten kayda huni, Google Ads ve bağlantılar",
        icon: Megaphone,
        modules: ["reklam"],
        match: ["/admin/site/baglantilar"],
        tabs: [
          L("/admin/site/reklam", "Reklam", "Ziyaretten kayda huni ve Google Ads önerileri", ["reklam"], {
            children: [
              L("/admin/site/reklam", "Huni", "Ziyaretten kayda huni ve ölçüm ayarları", ["reklam"]),
              L("/admin/site/reklam/google", "Google Ads", "Kampanya performansı ve kural önerileri", ["reklam"]),
            ],
          }),
          L("/admin/site/baglantilar", "Bağlantılar", "Search Console ve Google Ads bağlantıları", ["reklam"]),
        ],
      },
    ],
  },
  {
    // Genişleme 2026-10: kişisel veri ve erişim güvenliği tek grupta (üye/KVKK yetkili personel + sistem). Muhasebe görmez.
    id: "guvenlik",
    title: "Güvenlik & veri",
    items: [
      { href: "/admin/giris-guvenligi", label: "Giriş güvenliği", description: "Başarısız giriş, şüpheli IP, hedeflenen hesap, 2FA", icon: KeyRound, modules: ["members"] },
      { href: "/admin/tickets/kvkk", label: "KVKK başvuruları", description: "Veri sahibi başvuruları, 30 gün sayacı ve yanıt", icon: ShieldCheck, modules: ["members"], badgeKey: "kvkk" },
      { href: "/admin/ileti-izni", label: "İleti izinleri (İYS)", description: "Kanal bazında izin oranı ve ret hareketleri", icon: MessageSquareText, modules: ["members"] },
      { href: "/admin/veri-saklama", label: "Veri saklama", description: "Saklama süreleri, imha işi sonucu ve yedekler", icon: Database, modules: ["sistem"] },
    ],
  },
  {
    id: "sistem",
    title: "Sistem",
    items: [
      {
        href: "/admin/sistem", mobileTab: true,
        label: "Sistem durumu",
        short: "Sistem",
        description: "Sağlık, hatalar, uyarılar, durum sayfası ve veritabanı",
        icon: Radar,
        modules: ["sistem", "veri"],
        tabs: [
          L("/admin/sistem", "Sağlık", "Cron nabzı, veritabanı, yedek ve şema", ["sistem"]),
          L("/admin/sistem?sekme=hatalar", "Hata kayıtları", "Uygulama hataları", ["sistem"]),
          L("/admin/sistem?sekme=uyarilar", "Uyarılar", "Operasyon uyarıları ve uyarı günlüğü", ["sistem"]),
          L("/admin/sistem?sekme=durum", "Durum sayfası", "Kamuya açık /durum: olay, bakım ve sürüm geçmişi", ["sistem"]),
          L("/admin/sistem?sekme=kaynaklar", "Kaynaklar", "Sunucu kaynakları ve depolama", ["sistem"]),
          L("/admin/sistem?sekme=veritabani", "Veritabanı", "Tablo boyutları, bağlantılar ve yavaş sorgular", ["sistem"]),
          // SN4: kendi modülü (`veri`) var; varsayılan yalnız süper admin, başka personel yalnız özel rolle görür.
          L("/admin/sistem?sekme=veri", "Veri gezgini", "İzinli tablolarda salt okunur, maskeli ve denetim izli arama", ["veri"]),
        ],
      },
      { href: "/admin/kuyruklar", label: "Kuyruklar", description: "Bekleyen, takılan ve hatalı işler; yeniden deneme", icon: Inbox, modules: ["sistem"] },
      { href: "/admin/aktivite", label: "Aktivite", description: "Denetim izi: personel, ofis ve sistem işlemleri", icon: Activity, modules: ["activity"] },
      {
        href: "/admin/geo",
        label: "Coğrafya",
        description: "İl, ilçe, mahalle verisi; içe aktarma, sürümler ve talepler",
        icon: MapPin,
        modules: ["geo"],
        tabs: [
          L("/admin/geo", "Gezgin", "İl, ilçe ve mahalle gezgini", ["geo"]),
          L("/admin/geo/ice-aktar", "İçe aktar", "Resmi veri setinden içe aktarma", ["geo"]),
          L("/admin/geo/surumler", "Sürümler", "Veri sürümleri ve geri alma", ["geo"]),
          L("/admin/geo/talepler", "Değişiklik talepleri", "Ofislerden gelen ad ve sınır düzeltme talepleri", ["geo"]),
          L("/admin/geo/saglik", "Veri tutarlılığı", "Eksik, yinelenen ve bozuk kayıt denetimi", ["geo"]),
          L("/admin/geo/eslestir", "Eşleştir", "Serbest metin adresleri resmi kayıtlarla eşleştirme", ["geo"]),
          L("/admin/geo/kullanim", "Kullanım", "Coğrafya verisinin ofislerde kullanımı ve arama istatistikleri", ["geo"]),
        ],
      },
    ],
  },
  {
    id: "yapay-zeka",
    title: "AI & entegrasyon",
    items: [
      { href: "/admin/danisman", label: "AI danışmanı", description: "Platform verisinden içgörü ve soru-cevap", icon: Sparkles, modules: ["advisor"] },
      { href: "/admin/ai-kullanim", label: "AI kullanımı", description: "AI kredi tüketimi, maliyet tablosu ve ofis bazında kullanım", icon: Bot, modules: ["billing"] },
      {
        href: "/admin/sistem?sekme=entegrasyonlar",
        label: "Entegrasyonlar",
        description: "Ödeme, SMS, e-posta, WhatsApp, Google, AI, EİDS: durum, test ve anahtarlar",
        icon: Plug,
        modules: ["sistem"],
      },
      { href: "/admin/portal-hesaplari", label: "Portal hesapları", description: "Ofis portal hesapları ve ilan doğrulama", icon: Link2, modules: ["sistem"] },
    ],
  },
  {
    id: "yonetim",
    title: "Yönetim",
    required: true,
    items: [
      {
        href: "/admin/personel",
        label: "Personel ve roller",
        description: "EmlakSoft çalışanları, roller ve güvenlik politikası",
        icon: ShieldCheck,
        modules: ["personel"],
        tabs: [
          L("/admin/personel", "Personel", "EmlakSoft çalışanları", ["personel"]),
          L("/admin/personel/roller", "Roller", "Özel roller ve modül yetkileri", ["personel"]),
          L("/admin/personel/guvenlik", "Güvenlik politikası", "İki adımlı doğrulama, erişim ve demo girişi", ["personel"]),
        ],
      },
      { href: "/admin/ayarlar/menu", label: "Menü yönetimi", description: "Ofis paneli ve admin menüsü: göster/gizle, sırala, adlandır", icon: LayoutList, modules: ["sistem"] },
      {
        href: "/admin/ayarlar", dock: true,
        label: "Ayarlar",
        description: "Platform ayarları, bayraklar, yasal metinler, şablonlar",
        icon: Settings,
        modules: ["sistem"],
        exclude: ["/admin/ayarlar/menu"],
        tabs: [
          L("/admin/ayarlar", "Ayar merkezi", "Tüm ayarlar, kayıt ve bakım, deneme ve yenileme, geçmiş", ["sistem"]),
          L("/admin/ayarlar/bayraklar", "Özellik bayrakları", "Açma/kapama bayrakları, hedefleme ve etkisi", ["sistem"]),
          L("/admin/ayarlar/yasal", "Yasal metinler", "Form onay metinleri ve mevzuat sabitleri", ["sistem"]),
          L("/admin/ayarlar/eposta", "E-posta şablonları", "İşlemsel e-posta şablonları, gönderim günlüğü ve engel listesi", ["sistem"]),
          L("/admin/ayarlar/tufe", "TÜFE tablosu", "Kira artışı oranları", ["sistem"]),
        ],
      },
    ],
  },
];

/** Hesabım (kullanıcı menüsü ve yan menü alt bölümü) gibi grup dışı ama aranabilen hedefler. */
export const ADMIN_EXTRA_PALETTE: readonly AdminNavLink[] = [L("/admin/hesabim", "Hesabım", "Parola, oturum ve iki adımlı doğrulama", ["dashboard"])];

export const ICONS_FOR_TABS: Record<string, LucideIcon> = { activity: Activity, flag: Flag, scale: Scale, receipt: Receipt };

const canSee = (link: Pick<AdminNavLink, "modules" | "when">, allowed: readonly PlatformModule[], conditions: AdminNavConditions = {}) =>
  link.modules.some((m) => allowed.includes(m)) && (!link.when || conditions[link.when] !== false);

/**
 * Sıfır çıkmaz: öğenin kendi sekmesi (href'i) rolde görünmüyorsa satır ilk GÖRÜNÜR sekmeye gider (ör. yalnız `veri`
 * modülü olan özel rol "Sistem durumu"na tıklayınca `sistem` kapısından /admin'e geri atılmaz, Veri gezgini açılır).
 * Kök /admin herkesin iniş sayfasıdır; değiştirilmez.
 */
const reachableHref = (item: AdminNavItem, tabs: readonly AdminNavLink[] | undefined): string => {
  if (item.href === "/admin" || !tabs?.length || !item.tabs?.some((t) => t.href === item.href)) return item.href;
  return tabs.some((t) => t.href === item.href) ? item.href : tabs[0]!.href;
};

/** Menü yönetimi farkını grup listesine uygular: gizli gruplar atılır (zorunlular hariç), sıra verilen kimliklere göre. */
export function applyAdminNavOverrides<S extends Pick<AdminNavSection, "id" | "required">>(sections: readonly S[], overrides?: AdminNavOverrides | null): S[] {
  if (!overrides) return [...sections];
  const hidden = new Set(overrides.hiddenGroups ?? []);
  const order = (overrides.groupOrder ?? []).filter((id) => sections.some((s) => s.id === id));
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length + sections.findIndex((s) => s.id === id) : i;
  };
  return sections.filter((s) => s.required || !hidden.has(s.id)).sort((a, b) => rank(a.id) - rank(b.id));
}

/** Role (ve koşullara) göre görünür menü (boş bölümler atılır; sekmeler de role göre süzülür; menü yönetimi farkı uygulanır). */
export function adminNavFor(allowed: readonly PlatformModule[], conditions: AdminNavConditions = {}, overrides?: AdminNavOverrides | null): AdminNavSection[] {
  const sections = ADMIN_NAV.map((s) => ({
    ...s,
    items: s.items
      .filter((i) => canSee(i, allowed, conditions))
      .map((i) => {
        const tabs = i.tabs
          ?.filter((t) => canSee(t, allowed, conditions))
          .map((t) => (t.children ? { ...t, children: t.children.filter((c) => canSee(c, allowed, conditions)) } : t));
        return { ...i, href: reachableHref(i, tabs), tabs };
      }),
  })).filter((s) => s.items.length > 0);
  return applyAdminNavOverrides(sections, overrides);
}

const pathOf = (href: string) => href.split(/[?#]/)[0]!;
const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

const sekmeOf = (href: string): string | null => {
  const q = href.split("#")[0]!.split("?")[1];
  return q ? new URLSearchParams(q).get("sekme") : null;
};

/**
 * Öğe aktif mi: kendi yolu ya da `match` önekleri (kök /admin yalnız tam eşleşir). `?sekme=` taşıyan öğe (Entegrasyonlar)
 * yalnız aynı yolda o sekme açıkken etkindir; `sekme` verilmezse yalnız yol sayılır.
 */
export function isAdminNavActive(pathname: string, item: Pick<AdminNavItem, "href" | "match" | "exclude">, sekme?: string | null): boolean {
  const own = sekmeOf(item.href);
  if (own) return pathname === pathOf(item.href) && sekme === own;
  if (item.href === "/admin") return pathname === "/admin" || (item.match ?? []).some((p) => under(pathname, p));
  if (item.exclude?.some((e) => under(pathname, e))) return false;
  return [pathOf(item.href), ...(item.match ?? [])].some((p) => under(pathname, p));
}

/**
 * Bulunulan sayfanın menü öğesi (yan menü vurgusu, sekme şeridi ve başlık için). Önce `?sekme=` öğeleri (Entegrasyonlar),
 * sonra yol öğeleri: /admin/sistem?sekme=entegrasyonlar "Sistem durumu"nu değil Entegrasyonlar'ı etkin yapar. Yalnız
 * `veri` modülü olan rolde Sistem durumu satırı Veri gezginine gider ve sekme öğesi gibi eşleşir.
 */
export function activeAdminItem(pathname: string, sections: readonly AdminNavSection[] = ADMIN_NAV, sekme?: string | null): AdminNavItem | null {
  const items = sections.flatMap((s) => s.items);
  if (sekme) {
    const hit = items.find((i) => sekmeOf(i.href) === sekme && pathOf(i.href) === pathname && !i.tabs?.some((t) => t.href === i.href));
    if (hit) return hit;
  }
  for (const i of items) {
    if (sekmeOf(i.href) && !i.tabs?.some((t) => t.href === i.href)) continue;
    if (isAdminNavActive(pathname, sekmeOf(i.href) ? { ...i, href: pathOf(i.href) } : i, sekme)) return i;
  }
  return null;
}

/** Sekmenin şeritteki anahtarı: `?sekme=` taşıyan sekmede tam adres, diğerlerinde yol (bkz. activeTabHref). */
export const tabKey = (href: string): string => (sekmeOf(href) ? href : pathOf(href));

/**
 * Sekme aktif mi: en uzun eşleşen yol kazanır (/admin/ayarlar/yasal/[slug], /admin/ayarlar/yasal sekmesini etkin yapar). Alt sayfalar (`children`)
 * da sekmenin yoludur: /admin/site/sayfalar "İçerik" sekmesini etkin yapar ("Genel bakış" /admin/site'ı değil).
 * Sorgu sekmesi: href'i `?sekme=X` taşıyan sekme (ör. "Hata kayıtları" = `/admin/sistem?sekme=hatalar`) yalnız aynı yolda
 * `sekme` X iken etkindir ve yol eşleşmesinden önce gelir; o zaman tam href döner (yol sekmesi etkin görünmez).
 */
export function activeTabHref(pathname: string, tabs: readonly AdminNavLink[], sekme?: string | null): string | null {
  if (sekme) {
    const hit = tabs.find((t) => sekmeOf(t.href) === sekme && pathOf(t.href) === pathname);
    if (hit) return hit.href;
  }
  let best: { len: number; href: string } | null = null;
  for (const t of tabs) {
    if (sekmeOf(t.href)) continue;
    for (const p of [pathOf(t.href), ...(t.children ?? []).map((c) => pathOf(c.href))]) {
      if (under(pathname, p) && (!best || p.length > best.len)) best = { len: p.length, href: pathOf(t.href) };
    }
  }
  return best?.href ?? null;
}

export function activeChildHref(pathname: string, tab: AdminNavLink | null | undefined): string | null {
  return tab?.children?.length ? activeTabHref(pathname, tab.children) : null;
}

/** En çok 5 görünür sekme; kalanlar ve `overflow` işaretliler "Diğer ▾" altına girer. */
export const MAX_VISIBLE_TABS = 5;

export function splitTabs(tabs: readonly AdminNavLink[], max = MAX_VISIBLE_TABS): { visible: AdminNavLink[]; more: AdminNavLink[] } {
  const visible = tabs.filter((t) => !t.overflow).slice(0, max);
  const shown = new Set(visible.map((t) => t.href));
  return { visible, more: tabs.filter((t) => !shown.has(t.href)) };
}

/** Bölüm sekmelerinde boşta önceden yüklenecek en çok kardeş sekme (B025). */
export const ADMIN_TAB_PREFETCH_MAX = 8;

/**
 * Boşta önceden yüklenecek kardeş sekmeler: önce şeritte görünenler, sonra "Diğer" altındakiler ve etkin sekmenin alt
 * sayfaları; etkin sekme ve yinelenen adresler hariç. Sıra = olası tıklama sırası (ortak kuyruk sırayla işler).
 */
export function adminTabPrefetchTargets(tabs: readonly AdminNavLink[], current: string | null, max = ADMIN_TAB_PREFETCH_MAX): string[] {
  const { visible, more } = splitTabs(tabs);
  const children = tabs.find((t) => t.href === current)?.children ?? [];
  const out: string[] = [];
  for (const l of [...visible, ...children, ...more]) {
    if (l.href === current || out.includes(l.href)) continue;
    out.push(l.href);
    if (out.length >= max) break;
  }
  return out;
}

/** Mobil alt çubuktaki menü yuvası sayısı ("Menü" düğmesi hariç; toplam ≤5). */
export const ADMIN_MOBILE_TAB_SLOTS = 4;

/**
 * Mobil alt çubuk öğeleri (B145): menü sırasının ilk 4 öğesi DEĞİL, mobil önceliği. Seçim sırası: (1) `mobileTab`
 * işaretliler (Kontrol paneli, Ofisler, Talepler, Sistem durumu: gece işi ve kuyruk), (2) rozet taşıyan öğeler,
 * (3) diğerleri; seçilenler menü sırasıyla çizilir (yer değiştirmez). Rol görmediği öğeyi almaz: yalnız `adminNavFor`
 * süzgecinden geçenler. Rozet sayısı yerine rozet ANAHTARI kullanılır: sayı akışla gelir, çubuk sonradan yer
 * değiştirmesin (CLS yok). Alt sabit (dock) öğeler alt çubuğa girmez.
 */
export function adminMobileTabs(allowed: readonly PlatformModule[], slots = ADMIN_MOBILE_TAB_SLOTS): AdminNavItem[] {
  const ordered = adminNavFor(allowed).flatMap((s) => s.items).filter((i) => !i.dock);
  const rank = (i: AdminNavItem) => (i.mobileTab ? 0 : i.badgeKey ? 1 : 2);
  const picked = new Set(
    ordered
      .map((item, index) => ({ item, index }))
      .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
      .slice(0, slots)
      .map((x) => x.item.href),
  );
  return ordered.filter((i) => picked.has(i.href));
}

/** Komut paleti komutları: menü öğeleri + sekmeler + palet hedefleri (yinelenen yol bir kez). */
export function adminPaletteFor(allowed: readonly PlatformModule[]): Array<AdminNavLink & { icon: LucideIcon }> {
  const out: Array<AdminNavLink & { icon: LucideIcon }> = [];
  const seen = new Set<string>();
  const push = (l: AdminNavLink, icon: LucideIcon) => {
    if (seen.has(l.href) || !canSee(l, allowed)) return;
    seen.add(l.href);
    out.push({ ...l, icon });
  };
  for (const s of ADMIN_NAV) {
    for (const i of s.items) {
      push(i, i.icon);
      for (const t of i.tabs ?? []) {
        push(t, i.icon);
        for (const c of t.children ?? []) push(c, i.icon);
      }
      for (const p of i.palette ?? []) push(p, i.icon);
    }
  }
  for (const e of ADMIN_EXTRA_PALETTE) push(e, Settings);
  return out;
}

export type AdminSidebarGroup = { section: AdminNavSection; items: AdminNavItem[] };
export type AdminSidebarModel = { groups: AdminSidebarGroup[]; dock: AdminNavItem[] };

/**
 * Yan menü görünümü: her grup kendi başlığıyla, TÜM öğeleriyle (gizli "+N daha" yok); grup satır içi açılır alandır
 * (akordeon, istemci durumu). Alt sabit (`dock`) öğeler gruptan çıkar, alt bölümde çizilir. Boş grup çizilmez.
 */
export function adminSidebarModel(allowed: readonly PlatformModule[], conditions: AdminNavConditions = {}, overrides?: AdminNavOverrides | null): AdminSidebarModel {
  const sections = adminNavFor(allowed, conditions, overrides);
  const dock = sections.flatMap((s) => s.items.filter((i) => i.dock));
  const groups = sections
    .map((section) => ({ section, items: section.items.filter((i) => !i.dock) }))
    .filter((g) => g.items.length > 0);
  return { groups, dock };
}

/** Admin grupları (Menü yönetimi ekranı): kimlik, başlık, zorunlu mu ve satır adları (önizleme). */
export function adminNavGroupCatalog(): { id: string; title: string; required: boolean; items: { href: string; label: string }[] }[] {
  return ADMIN_NAV.map((s) => ({ id: s.id, title: s.title, required: Boolean(s.required), items: s.items.filter((i) => !i.dock).map((i) => ({ href: i.href, label: i.label })) }));
}
