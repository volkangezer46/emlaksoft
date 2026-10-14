import {
  Activity,
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
 * Yan menü (UXD-3): tek öğeli grup başlıksız düz satırdır; çok öğeli grupta çekirdek satır hep görünür, kalan öğeler
 * grubun kendi açılır alanındadır (eski ortak "Diğer" grubu yok: Büyüme/Analiz tarifesi Gelir'de, Toplu duyuru
 * Destek'te, Coğrafya/Personel/Ayarlar Sistem'de).
 * Kaldırılan "Demo & aday" (self-servis kayıt; demo talebi/aday takibi yok): deneme hunisi /admin/tenants?durum=trial.
 */

export type AdminBadgeKey = "tickets" | "risk";

export type AdminNavLink = {
  href: string;
  label: string;
  description: string;
  modules: readonly PlatformModule[];
  /** Sekmenin alt sayfaları: sekme etkinken şeridin İKİNCİ satırında çizilir (ör. İçerik > Ana sayfa · Sayfalar). */
  children?: readonly AdminNavLink[];
  /** Sekmeyi her zaman "Diğer ▾" altına koy (5 görünür sekme kuralından bağımsız). */
  overflow?: boolean;
};

/** Bölüm sekmesi (sekme şeridi ve komut paleti). */
export type NavTab = AdminNavLink;

export type AdminNavItem = AdminNavLink & {
  icon: LucideIcon;
  /** Mobil alt çubukta dar yuvaya sığan kısa ad (tam ad `aria-label`/`title` olarak kalır). */
  short?: string;
  badgeKey?: AdminBadgeKey;
  /** Yan menüde her zaman görünen ÇEKİRDEK öğe; çekirdek olmayanlar grup içinde "+N daha" ile katlanır (tam liste ⌘K'da). */
  core?: boolean;
  match?: readonly string[];
  /** Aktif sayılmayacak alt yollar (ör. ayrı öğesi olan bir alt bölüm). */
  exclude?: readonly string[];
  tabs?: readonly AdminNavLink[];
  palette?: readonly AdminNavLink[];
};

export type AdminNavSection = { id: string; title: string | null; items: readonly AdminNavItem[] };

const L = (href: string, label: string, description: string, modules: readonly PlatformModule[], extra?: Pick<AdminNavLink, "children" | "overflow">): AdminNavLink => ({ href, label, description, modules, ...extra });

export const ADMIN_NAV: readonly AdminNavSection[] = [
  {
    id: "genel",
    title: "Genel bakış",
    items: [
      {
        // Raporlar ve AI danışmanı ayrı menü satırı değil, Kontrol panelinin sekmesidir (menü bütçesi: admin <= 6).
        href: "/admin", core: true,
        label: "Kontrol paneli",
        short: "Panel",
        description: "Canlı metrikler, dikkat kuyruğu, raporlar ve AI danışmanı",
        icon: LayoutDashboard,
        modules: ["dashboard", "reports", "advisor"],
        match: ["/admin/raporlar", "/admin/danisman"],
        tabs: [
          L("/admin", "Kontrol paneli", "Canlı metrikler, dikkat kuyruğu, öneriler", ["dashboard"]),
          L("/admin/raporlar", "Raporlar", "Platform analizi: gelir, aktivasyon, modül kullanımı", ["reports"]),
          L("/admin/danisman", "AI danışmanı", "Platform verisinden içgörü ve soru-cevap", ["advisor"]),
        ],
      },
    ],
  },
  {
    id: "musteriler",
    title: "Müşteriler",
    items: [
      {
        href: "/admin/tenants", core: true,
        label: "Ofisler",
        description: "Ofis envanteri, deneme, risk, abonelik durumu ve üyeler",
        icon: Building2,
        modules: ["tenants", "members"],
        // Üyeler ayrı menü satırı değil, Ofisler bölümünün sekmesidir (menü bütçesi: admin <= 6).
        match: ["/admin/members"],
        tabs: [
          L("/admin/tenants", "Ofisler", "Ofis envanteri, deneme, risk ve abonelik durumu", ["tenants"]),
          L("/admin/members", "Üyeler", "Ofis kullanıcıları ve hesap durumu", ["members"]),
        ],
        badgeKey: "risk",
        palette: [L("/admin/tenants/yeni", "Yeni ofis aç", "Ofis aç ve sahibine erişim ver", ["sales"]), L("/admin/tenants?durum=trial", "Denemedeki ofisler", "Self-servis deneme hunisi", ["tenants"]), L("/admin/tenants?deneme=bitiyor", "Denemesi bitmek üzere olan ofisler", "7 gün içinde biten denemeler", ["tenants"])],
      },
    ],
  },
  {
    id: "gelir",
    title: "Gelir",
    items: [
      {
        href: "/admin/billing", core: true,
        label: "Abonelikler",
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
      { href: "/admin/growth", label: "Büyüme", description: "Davet ve ortak programı, kayıt kaynakları (site trafiği, SEO ve reklam önerileri: Site, SEO ve Reklam)", icon: Sprout, modules: ["sales"] },
      { href: "/admin/analiz-tarifesi", label: "Analiz tarifesi", description: "Analiz tarifesi, paketler, ofis bakiyeleri", icon: Coins, modules: ["billing"] },
      { href: "/admin/ai-kullanim", label: "AI kullanımı", description: "AI kredi tüketimi ve maliyet tablosu", icon: Sparkles, modules: ["billing"] },
    ],
  },
  {
    id: "icerik",
    title: "İçerik",
    items: [
      {
        href: "/admin/site", core: true,
        label: "Site, SEO ve Reklam",
        short: "Site",
        description: "Büyüme kokpiti (Site notu, öneri kuyruğu, Otopilot), içerik ve sayfalar, SEO, hız, reklam hunisi, medya, rehber, Google bağlantıları, site menüsü, logo ve favicon",
        icon: Globe,
        modules: ["sitecontent", "sitemenu", "seo", "marka", "reklam"],
        match: ["/admin/site", "/admin/site-icerik", "/admin/site-menu", "/admin/seo", "/admin/marka"],
        // İlk 5 sekme şeritte görünür; Hız, Reklam, Medya, Rehber ve Bağlantılar (S1 dikişi) "Diğer ▾" altındadır.
        // Sekmenin modülü, açtığı sayfanın kapısıyla (requirePlatformModule) AYNIDIR: görünen sekme her zaman açılır.
        tabs: [
          L("/admin/site", "Genel bakış", "Büyüme kokpiti: Site notu, öneri kuyruğu, Otopilot ve Yayın masası", ["sitecontent", "sitemenu", "seo", "marka", "reklam"]),
          L("/admin/site-icerik", "İçerik", "Ana sayfa metinleri, fiyatlar ve özel sayfalar", ["sitecontent"], {
            children: [
              L("/admin/site-icerik", "Ana sayfa", "Ana sayfa metinleri, bölüm düzeni, SSS", ["sitecontent"]),
              L("/admin/site/sayfalar", "Sayfalar", "Fiyatlar ve özel sayfalar (Hakkımızda, İletişim, kampanya)", ["sitecontent"]),
            ],
          }),
          L("/admin/seo", "SEO", "Arama motoru, sitemap, robot", ["seo"]),
          L("/admin/site-menu", "Site menüsü", "Menü, alt bilgi, duyuru şeridi", ["sitemenu"]),
          L("/admin/marka", "Marka", "Logo ve favicon", ["marka"]),
          L("/admin/site/hiz", "Hız", "Statik sayfalar, hız bütçesi, saha ve laboratuvar ölçümleri", ["sitecontent"], {
            children: [
              L("/admin/site/hiz", "Genel", "Statik sunum ve hız bütçesi", ["sitecontent"]),
              L("/admin/site/hiz/saha", "Saha", "Gerçek ziyaretçi hız ölçümleri (Core Web Vitals)", ["seo"]),
              L("/admin/site/hiz/lab", "Laboratuvar", "PageSpeed laboratuvar koşuları", ["sitecontent"]),
            ],
          }),
          L("/admin/site/reklam", "Reklam", "Ziyaretten kayda huni, kayıt kaynakları ve Google Ads önerileri", ["seo"], {
            children: [
              L("/admin/site/reklam", "Huni", "Ziyaretten kayda huni ve kayıt kaynakları", ["seo"]),
              L("/admin/site/reklam/google", "Google Ads", "Kampanya performansı ve kural önerileri", ["reklam"]),
            ],
          }),
          L("/admin/site/medya", "Medya", "Görsel kitaplığı ve görsel bütçesi", ["sitecontent"]),
          L("/admin/site/rehber", "Rehber", "Rehber (blog) yazıları: taslak, yayın ve sürümler", ["sitecontent"]),
          L("/admin/site/baglantilar", "Bağlantılar", "Google Search Console ve Google Ads bağlantıları", ["reklam"]),
        ],
      },
    ],
  },
  {
    id: "destek",
    title: "Destek",
    items: [
      {
        href: "/admin/tickets", core: true,
        label: "Talepler",
        description: "Destek kuyruğu ve yanıt süreleri",
        icon: LifeBuoy,
        modules: ["tickets"],
        badgeKey: "tickets",
        palette: [
          L("/admin/tickets/yeni", "Yeni destek talebi", "Ofis adına talep aç", ["tickets"]),
          L("/admin/tickets/oneriler", "Öneri panosu", "Ofislerin özellik önerileri, oylar ve durum (planlandı / yapılıyor / yayında)", ["tickets"]),
        ],
      },
      {
        href: "/admin/duyuru",
        label: "Toplu duyuru",
        description: "Ofislere duyuru ve bildirim gönder, banner, Yenilikler ve NPS anketi",
        icon: Megaphone,
        modules: ["broadcast"],
        palette: [L("/admin/duyuru?sekme=nps", "NPS anketi", "Ürün içi memnuniyet anketi ve sonuçları", ["broadcast"])],
      },
    ],
  },
  {
    id: "sistem",
    title: "Sistem",
    items: [
      {
        href: "/admin/sistem", core: true,
        label: "Sistem durumu",
        description: "Sağlık, cron nabzı, entegrasyonlar, hata ve aktivite kaydı",
        icon: Radar,
        modules: ["sistem", "activity"],
        match: ["/admin/sistem", "/admin/aktivite"],
        tabs: [
          L("/admin/sistem", "Sağlık ve entegrasyonlar", "Cron, veritabanı, anahtarlar, kayıt ve bakım", ["sistem"]),
          L("/admin/sistem?sekme=hatalar", "Hata kayıtları", "Uygulama hataları", ["sistem"]),
          L("/admin/aktivite", "Aktivite kaydı", "Denetim izi", ["activity"]),
        ],
      },
      { href: "/admin/geo", label: "Coğrafya", description: "İl, ilçe, mahalle verisi; içe aktarma ve eşleştirme sekmeleri", icon: MapPin, modules: ["geo"] },
      { href: "/admin/personel", label: "Personel", description: "EmlakSoft çalışanları ve rolleri", icon: ShieldCheck, modules: ["personel"] },
      {
        href: "/admin/ayarlar/merkez",
        label: "Ayarlar",
        description: "Genel platform ayarları, özellik bayrakları, yasal metinler",
        icon: Settings,
        modules: ["sistem"],
        match: ["/admin/ayarlar"],
        tabs: [
          L("/admin/ayarlar/merkez", "Ayar merkezi", "Tüm ayarlar, geçmiş, gizli anahtarlar", ["sistem"]),
          L("/admin/ayarlar/bayraklar", "Özellik bayrakları", "Açma/kapama bayrakları ve etkisi", ["sistem"]),
          L("/admin/ayarlar/yasal", "Yasal metinler", "Form onay metinleri ve mevzuat sabitleri", ["sistem"]),
          L("/admin/ayarlar/eposta", "E-posta şablonları", "E-posta kanalı durumu ve işlemsel şablonlar", ["sistem"]),
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
    items: s.items
      .filter((i) => canSee(i, allowed))
      .map((i) => ({
        ...i,
        tabs: i.tabs?.filter((t) => canSee(t, allowed)).map((t) => (t.children ? { ...t, children: t.children.filter((c) => canSee(c, allowed)) } : t)),
      })),
  })).filter((s) => s.items.length > 0);
}

const pathOf = (href: string) => href.split(/[?#]/)[0]!;
const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Öğe aktif mi: kendi yolu ya da `match` önekleri (kök /admin yalnız tam eşleşir). */
export function isAdminNavActive(pathname: string, item: Pick<AdminNavItem, "href" | "match" | "exclude">): boolean {
  // Kök /admin yalnız tam eşleşir; ama sekmeleri (Raporlar, AI danışmanı) `match` önekleriyle Kontrol panelini etkin yapar.
  if (item.href === "/admin") return pathname === "/admin" || (item.match ?? []).some((p) => under(pathname, p));
  if (item.exclude?.some((e) => under(pathname, e))) return false;
  return [pathOf(item.href), ...(item.match ?? [])].some((p) => under(pathname, p));
}

/** Bulunulan sayfanın menü öğesi (sekme şeridi ve başlık için). */
export function activeAdminItem(pathname: string, sections: readonly AdminNavSection[] = ADMIN_NAV): AdminNavItem | null {
  for (const s of sections) for (const i of s.items) if (isAdminNavActive(pathname, i)) return i;
  return null;
}

const sekmeOf = (href: string): string | null => {
  const q = href.split("#")[0]!.split("?")[1];
  return q ? new URLSearchParams(q).get("sekme") : null;
};

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

export type AdminSidebarGroup = { section: AdminNavSection; items: AdminNavItem[]; folded: AdminNavItem[] };

/**
 * Yan menü görünümü: her grupta çekirdek (`core`) öğeler görünür, kalanı "+N daha" ile katlanır. Gruptaki hiçbir öğe çekirdek
 * değilse (ör. role göre süzülünce) grup tam gösterilir; böylece rol hiçbir sayfayı kaybetmez, yalnız menü kısalır.
 */
export function adminSidebarModel(allowed: readonly PlatformModule[]): AdminSidebarGroup[] {
  return adminNavFor(allowed).map((section) => {
    const items = section.items.filter((i) => i.core);
    if (items.length === 0) return { section, items: [...section.items], folded: [] };
    return { section, items, folded: section.items.filter((i) => !i.core) };
  });
}
