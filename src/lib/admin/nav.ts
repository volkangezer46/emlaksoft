import {
  Activity,
  Bell,
  Bot,
  BrainCircuit,
  Building2,
  ClipboardCheck,
  CreditCard,
  Coins,
  Flag,
  Gauge,
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
  MonitorSmartphone,
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
import { bindAdminNav, canSee, type AdminNavLink, type AdminNavSection } from "./nav-core";

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

export {
  ADMIN_BADGE_LABEL,
  ADMIN_BADGE_TONE,
  ADMIN_MOBILE_TAB_SLOTS,
  ADMIN_TAB_PREFETCH_MAX,
  MAX_VISIBLE_TABS,
  activeChildHref,
  activeTabHref,
  adminTabPrefetchTargets,
  applyAdminNavOverrides,
  isAdminNavActive,
  splitTabs,
  tabKey,
} from "./nav-core";
export type {
  AdminBadgeKey,
  AdminNavCondition,
  AdminNavConditions,
  AdminNavItem,
  AdminNavLink,
  AdminNavOverrides,
  AdminNavSection,
  AdminSidebarGroup,
  AdminSidebarModel,
  NavTab,
} from "./nav-core";

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
      { href: "/admin/onaylar", label: "Onaylar", description: "Dört göz onayı bekleyen kritik işlemler", icon: ClipboardCheck, modules: ["billing", "tenants", "personel", "members", "sistem"], badgeKey: "approvals" },
      { href: "/admin/bildirimler", label: "Bildirimler", description: "Platform bildirim kutusu: uyarılar, talepler ve sistem olayları", icon: Bell, modules: ["dashboard"] },
    ],
  },
  {
    id: "ofisler",
    title: "Ofisler ve üyeler",
    items: [
      {
        href: "/admin/tenants", mobileTab: true,
        label: "Ofisler",
        description: "Ofis envanteri, deneme, risk, abonelik durumu ve Ofis 360",
        icon: Building2,
        modules: ["tenants"],
        exclude: ["/admin/tenants/kurulum"],
        badgeKey: "risk",
        palette: [L("/admin/tenants/yeni", "Yeni ofis aç", "Ofis aç ve sahibine erişim ver", ["tenants"]), L("/admin/tenants?durum=trial", "Denemedeki ofisler", "Self-servis deneme hunisi", ["tenants"]), L("/admin/tenants?deneme=bitiyor", "Denemesi bitmek üzere olan ofisler", "7 gün içinde biten denemeler", ["tenants"]), L("/admin/tenants/demo", "Demo verisi", "Demo modundaki ofisler, kilit ve genel demo ofisinin sıfırlanması", ["tenants"])],
      },
      // Genişleme 2026-10: gece sağlık skorunun (tenant_health_daily) platform görünümü: düşenler, yeni riskliler, neden.
      { href: "/admin/ofis-sagligi", label: "Sağlık ve risk", description: "Sağlık skoru: düşenler, yeni riskliler ve nedeni", icon: HeartPulse, modules: ["tenants"] },
      // Genişleme sinyali: paket limitine (koltuk, portföy, müşteri, şube, AI kredisi) yaklaşan ofisler; satır Ofis 360 > Kullanım.
      { href: "/admin/paket-limitleri", label: "Paket limitleri", description: "Paket limitine yaklaşan ofisler: koltuk, portföy, AI kredisi", icon: Gauge, modules: ["tenants"] },
      // SN5: ofis bazında kurulum ilerlemesi (takılan adım süzgeci) + ürün turu ve kurulum adımları düzenleyicisi.
      { href: "/admin/tenants/kurulum", label: "Kurulum ve aktivasyon", description: "Kurulum ilerlemesi, ürün turu ve kurulum adımları", icon: Rocket, modules: ["sales"] },
      { href: "/admin/members", label: "Üyeler", description: "Ofis kullanıcıları ve hesap durumu", icon: Users, modules: ["members"] },
      // PA-2: platform personeli iş kuyruğu (bana atanan / atanmamış / geciken görevler + sorumlu olduğum ofisler).
      { href: "/admin/gorevler", label: "Görevler", description: "Takip görevleri, başarı kuralları ve ofislerim", icon: ListChecks, modules: ["tenants"] },
    ],
  },
  {
    id: "gelir",
    title: "Gelir ve abonelik",
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
    title: "İçerik ve SEO",
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
          L("/admin/site/seo", "SEO", "SEO puanı, öneriler ve otomatik düzeltmeler, anahtar kelimeler, programatik sayfalar, teknik tarama ve yapay zekâ arama", ["seo"]),
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
    title: "Güvenlik ve veri",
    items: [
      { href: "/admin/giris-guvenligi", label: "Giriş güvenliği", description: "Başarısız giriş, şüpheli IP, hedeflenen hesap, 2FA", icon: KeyRound, modules: ["members"] },
      { href: "/admin/ofis-oturumlari", label: "Ofis oturumları", description: "Ofis kullanıcılarının açık oturumları; tek ya da tüm oturumları kapat", icon: MonitorSmartphone, modules: ["members"] },
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
    title: "AI ve entegrasyon",
    items: [
      {
        // EmlakSoft Zeka yönetimi: bağlantı (OpenAI anahtarı, model, test), yüzeyler, davranış, bilgi, kullanım, kayıtlar.
        href: "/admin/zeka",
        label: "Yapay zeka merkezi",
        description: "Zeka: OpenAI bağlantısı, yüzeyler ve sınırlar, davranış, bilgi tabanı, kullanım ve sorgu kayıtları",
        icon: BrainCircuit,
        modules: ["advisor"],
        tabs: [
          L("/admin/zeka", "Bağlantı", "OpenAI anahtarı durumu, model ve bağlantı testi", ["advisor"]),
          L("/admin/zeka?sekme=yuzeyler", "Yüzeyler", "Ofis paneli, ana sayfa, vitrin ve yönetim: aç/kapa, kip, günlük sınırlar, jeton", ["advisor"]),
          L("/admin/zeka?sekme=davranis", "Davranış", "Kişilik ve ton, yüzey istemi ekleri, yasaklı konular, yanıt dili", ["advisor"]),
          L("/admin/zeka?sekme=bilgi", "Bilgi", "Bilgi kaynakları, dizin durumu, yeniden oluştur ve onaylı soru-cevaplar", ["advisor"]),
          L("/admin/zeka?sekme=kullanim", "Kullanım", "Yüzey, motor ve ofis bazında kullanım, harcanan kredi, cevapsız sorular", ["advisor"]),
          L("/admin/zeka?sekme=kayitlar", "Kayıtlar", "Kişisel verisi maskelenmiş sorgu günlüğü ve süzgeçler", ["advisor"]),
        ],
      },
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
export const ADMIN_EXTRA_PALETTE: readonly AdminNavLink[] = [
  L("/admin/hesabim", "Hesabım", "Parola, oturum ve iki adımlı doğrulama", ["dashboard"]),
];

export const ICONS_FOR_TABS: Record<string, LucideIcon> = { activity: Activity, flag: Flag, scale: Scale, receipt: Receipt };

const { adminNavFor, activeAdminItem, adminMobileTabs, adminSidebarModel } = bindAdminNav(ADMIN_NAV);

/** Katalog kuralları `nav-core.ts`'tedir (istemci de aynı kuralları kabuğun verdiği düz katalogla çalıştırır). */
export { adminNavFor, activeAdminItem, adminMobileTabs, adminSidebarModel };

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

/** Admin grupları (Menü yönetimi ekranı): kimlik, başlık, zorunlu mu ve satır adları (önizleme). */
export function adminNavGroupCatalog(): { id: string; title: string; required: boolean; items: { href: string; label: string }[] }[] {
  return ADMIN_NAV.map((s) => ({ id: s.id, title: s.title, required: Boolean(s.required), items: s.items.filter((i) => !i.dock).map((i) => ({ href: i.href, label: i.label })) }));
}
