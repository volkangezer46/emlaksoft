import {
  Activity,
  BarChart3,
  Building2,
  CreditCard,
  Coins,
  Flag,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Megaphone,
  Radar,
  Scale,
  Settings,
  ShieldCheck,
  Sparkles,
  Sprout,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { PlatformModule } from "@/lib/platform-access";

/**
 * /admin MENÜSÜ — TEK KAYNAK (yan menü, mobil çekmece, komut paleti ve bölüm sekmeleri buradan beslenir).
 *
 * Bilgi mimarisi kuralları:
 *  - Menü öğesi = bir İŞ ALANI. "Yeni / oluştur / ekle" türü eylemler, tek kaydın ayrıntısı ve alt araçlar menüde
 *    ayrı satır OLMAZ: listenin içinde birincil düğme (ör. Ofisler > "+ Yeni ofis") ya da bölümün sekmesidir.
 *  - `match`: öğeyi aktif yapan ek yol önekleri (alt sayfalar ve sekmeler menüde kendi öğesini vurgular).
 *  - `tabs`: bölümün sayfa sekmeleri; `AdminSectionTabs` kabukta otomatik çizer (billing ve geo kendi sekme
 *    bileşenini kullandığı için burada `tabs` vermez, yalnız `match`).
 *  - `palette`: menüde olmayan ama komut paletinde aranabilen hedefler (eylemler, alt sayfalar).
 *  - Görünürlük: `modules` listesinden en az biri rolde açıksa (sayfa kapısı ayrıca `requirePlatformModule`).
 * Kaldırılan "Demo & aday" (self-servis kayıt; demo talebi/aday takibi yok): eski /admin/satis -> /admin/tenants?durum=trial.
 */

export type AdminBadgeKey = "tickets" | "risk";

export type AdminNavLink = { href: string; label: string; description: string; modules: readonly PlatformModule[] };

export type AdminNavItem = AdminNavLink & {
  icon: LucideIcon;
  badgeKey?: AdminBadgeKey;
  match?: readonly string[];
  /** Aktif sayılmayacak alt yollar (ör. ayrı öğesi olan bir alt bölüm). */
  exclude?: readonly string[];
  tabs?: readonly AdminNavLink[];
  palette?: readonly AdminNavLink[];
};

export type AdminNavSection = { id: string; title: string | null; items: readonly AdminNavItem[] };

const L = (href: string, label: string, description: string, modules: readonly PlatformModule[]): AdminNavLink => ({ href, label, description, modules });

export const ADMIN_NAV: readonly AdminNavSection[] = [
  {
    id: "genel",
    title: "Genel bakış",
    items: [
      { href: "/admin", label: "Kontrol paneli", description: "Canlı metrikler, dikkat kuyruğu, öneriler", icon: LayoutDashboard, modules: ["dashboard"] },
      { href: "/admin/raporlar", label: "Raporlar", description: "Platform analizi: gelir, aktivasyon, modül kullanımı", icon: BarChart3, modules: ["reports"] },
      { href: "/admin/danisman", label: "Yapay zeka danışmanı", description: "Platform verisinden içgörü ve soru-cevap", icon: Sparkles, modules: ["advisor"] },
    ],
  },
  {
    id: "musteriler",
    title: "Müşteriler",
    items: [
      {
        href: "/admin/tenants",
        label: "Ofisler",
        description: "Ofis envanteri, deneme, risk ve abonelik durumu",
        icon: Building2,
        modules: ["tenants"],
        badgeKey: "risk",
        palette: [L("/admin/tenants/yeni", "Yeni ofis aç", "Ofis aç ve sahibine erişim ver", ["sales"]), L("/admin/tenants?durum=trial", "Denemedeki ofisler", "Self-servis deneme hunisi", ["tenants"]), L("/admin/tenants?deneme=bitiyor", "Denemesi bitmek üzere olan ofisler", "7 gün içinde biten denemeler", ["tenants"])],
      },
      { href: "/admin/members", label: "Üyeler", description: "Ofis kullanıcıları ve hesap durumu", icon: Users, modules: ["members"] },
    ],
  },
  {
    id: "gelir",
    title: "Gelir",
    items: [
      {
        href: "/admin/billing",
        label: "Abonelik & fatura",
        description: "MRR, faturalar, planlar, kuponlar, muhasebe ve deneme ayarları",
        icon: CreditCard,
        modules: ["billing"],
        match: ["/admin/billing", "/admin/muhasebe"],
        palette: [
          L("/admin/billing/planlar", "Plan editörü (fiyat, koltuk)", "Paket fiyatları ve sınırları", ["billing"]),
          L("/admin/billing/kuponlar", "Kuponlar", "İndirim kuponları", ["billing"]),
          L("/admin/muhasebe", "Muhasebe", "Tahsilat, KDV, muhasebeci CSV", ["billing"]),
          L("/admin/muhasebe/defter", "Fatura defteri", "Tüm faturalar", ["billing"]),
        ],
      },
      { href: "/admin/growth", label: "Büyüme", description: "Davet ve ortak programı, kayıt kaynakları", icon: Sprout, modules: ["sales"] },
      { href: "/admin/ef-kontor", label: "EmlakFiyati kontör", description: "Kontör tarifesi, paketler, ofis bakiyeleri", icon: Coins, modules: ["billing"] },
      { href: "/admin/ai-kullanim", label: "AI kullanımı", description: "AI kredi tüketimi ve maliyet tablosu", icon: Sparkles, modules: ["billing"] },
    ],
  },
  {
    id: "icerik",
    title: "İçerik",
    items: [
      {
        href: "/admin/site",
        label: "Site & marka",
        description: "Ana sayfa içeriği, site menüsü, SEO, logo ve favicon",
        icon: Globe,
        modules: ["sitecontent", "sitemenu", "seo", "marka"],
        match: ["/admin/site", "/admin/site-icerik", "/admin/site-menu", "/admin/seo", "/admin/marka"],
        tabs: [
          L("/admin/site", "Genel bakış", "Tüm site yönetim alanları", ["sitecontent", "sitemenu", "seo", "marka"]),
          L("/admin/site-icerik", "Site içeriği", "Ana sayfa metinleri, bölüm düzeni, SSS", ["sitecontent"]),
          L("/admin/site-menu", "Site menüsü", "Menü, alt bilgi, duyuru şeridi", ["sitemenu"]),
          L("/admin/seo", "SEO", "Arama motoru, sitemap, robot", ["seo"]),
          L("/admin/marka", "Marka", "Logo ve favicon", ["marka"]),
        ],
      },
      { href: "/admin/duyuru", label: "Toplu duyuru", description: "Ofislere duyuru ve bildirim gönder", icon: Megaphone, modules: ["broadcast"] },
      { href: "/admin/geo", label: "Coğrafya", description: "İl, ilçe, mahalle verisi; içe aktarma ve eşleştirme sekmeleri", icon: MapPin, modules: ["geo"] },
    ],
  },
  {
    id: "destek",
    title: "Destek",
    items: [
      {
        href: "/admin/tickets",
        label: "Destek talepleri",
        description: "Destek kuyruğu ve yanıt süreleri",
        icon: LifeBuoy,
        modules: ["tickets"],
        badgeKey: "tickets",
        palette: [L("/admin/tickets/yeni", "Yeni destek talebi", "Ofis adına talep aç", ["tickets"])],
      },
    ],
  },
  {
    id: "sistem",
    title: "Sistem",
    items: [
      {
        href: "/admin/sistem",
        label: "Sistem",
        description: "Sağlık, cron nabzı, entegrasyonlar, hata ve aktivite kaydı",
        icon: Radar,
        modules: ["sistem", "activity"],
        match: ["/admin/sistem", "/admin/hatalar", "/admin/aktivite"],
        tabs: [
          L("/admin/sistem", "Sağlık ve entegrasyonlar", "Cron, veritabanı, anahtarlar, kayıt ve bakım", ["sistem"]),
          L("/admin/hatalar", "Hata kayıtları", "Uygulama hataları", ["sistem"]),
          L("/admin/aktivite", "Aktivite kaydı", "Denetim izi", ["activity"]),
        ],
      },
      { href: "/admin/personel", label: "Personel", description: "EmlakSoft çalışanları ve rolleri", icon: ShieldCheck, modules: ["personel"] },
      {
        href: "/admin/ayarlar",
        label: "Ayarlar",
        description: "Genel platform ayarları, özellik bayrakları, yasal metinler",
        icon: Settings,
        modules: ["sistem"],
        match: ["/admin/ayarlar"],
        tabs: [
          L("/admin/ayarlar/merkez", "Ayar merkezi", "Tüm ayarlar, geçmiş, gizli anahtarlar", ["sistem"]),
          L("/admin/ayarlar/bayraklar", "Özellik bayrakları", "Açma/kapama bayrakları ve etkisi", ["sistem"]),
          L("/admin/ayarlar/yasal", "Yasal metinler", "Form onay metinleri ve mevzuat sabitleri", ["sistem"]),
          L("/admin/ayarlar/tufe", "TÜFE tablosu", "Kira artışı oranları", ["sistem"]),
        ],
      },
    ],
  },
];

/** Bildirim zili / hesabım gibi menü dışı ama aranabilen hedefler. */
export const ADMIN_EXTRA_PALETTE: readonly AdminNavLink[] = [
  L("/admin/bildirimler", "Bildirimler", "Platform bildirim kutusu", ["dashboard"]),
  L("/admin/hesabim", "Hesabım", "Parola ve oturum", ["dashboard"]),
];

export const ICONS_FOR_TABS: Record<string, LucideIcon> = { activity: Activity, flag: Flag, scale: Scale };

const canSee = (link: Pick<AdminNavLink, "modules">, allowed: readonly PlatformModule[]) => link.modules.some((m) => allowed.includes(m));

/** Role göre görünür menü (boş bölümler atılır; sekmeler de role göre süzülür). */
export function adminNavFor(allowed: readonly PlatformModule[]): AdminNavSection[] {
  return ADMIN_NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => canSee(i, allowed)).map((i) => ({ ...i, tabs: i.tabs?.filter((t) => canSee(t, allowed)) })),
  })).filter((s) => s.items.length > 0);
}

const pathOf = (href: string) => href.split(/[?#]/)[0]!;
const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Öğe aktif mi: kendi yolu ya da `match` önekleri (kök /admin yalnız tam eşleşir). */
export function isAdminNavActive(pathname: string, item: Pick<AdminNavItem, "href" | "match" | "exclude">): boolean {
  if (item.href === "/admin") return pathname === "/admin";
  if (item.exclude?.some((e) => under(pathname, e))) return false;
  return [pathOf(item.href), ...(item.match ?? [])].some((p) => under(pathname, p));
}

/** Bulunulan sayfanın menü öğesi (sekme şeridi ve başlık için). */
export function activeAdminItem(pathname: string, sections: readonly AdminNavSection[] = ADMIN_NAV): AdminNavItem | null {
  for (const s of sections) for (const i of s.items) if (isAdminNavActive(pathname, i)) return i;
  return null;
}

/** Sekme aktif mi: en uzun eşleşen sekme kazanır (/admin/ayarlar/merkez, /admin/ayarlar'ı ezmez). */
export function activeTabHref(pathname: string, tabs: readonly AdminNavLink[]): string | null {
  let best: string | null = null;
  for (const t of tabs) {
    const p = pathOf(t.href);
    if (under(pathname, p) && (!best || p.length > best.length)) best = p;
  }
  return best;
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
      for (const t of i.tabs ?? []) push(t, i.icon);
      for (const p of i.palette ?? []) push(p, i.icon);
    }
  }
  for (const e of ADMIN_EXTRA_PALETTE) push(e, Settings);
  return out;
}
