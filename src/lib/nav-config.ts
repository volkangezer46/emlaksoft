import {
  ArrowLeftRight,
  BadgeCheck,
  Calculator,
  Globe,
  KeySquare,
  LayoutDashboard,
  ListFilter,
  ListChecks,
  Presentation,
  Sunrise,
  Trophy,
  Tv,
  Workflow,
} from "lucide-react";
import { ICONS } from "@/lib/icons";
import { findActiveNavigationHref } from "@/lib/navigation";
import type { AppModule } from "@/lib/permissions";

/**
 * /app menüsünün TEK kaynağı. 55 düz link yerine 9 iş başlığı: kullanıcı önce
 * "ne yapıyorum" (bugün, müşteri, portföy, anlaşma…) seçer, sonra başlığın
 * içindeki sayfaya gider. Sayfa yolları DEĞİŞMEZ; hiçbir sayfa silinmedi, eski
 * bağlantılar ve yer imleri çalışır. Menüde görünmeyen alt sayfalar (ör.
 * /app/ayarlar/filigran, /app/ekip/izinler) bağlı oldukları öğenin içindedir
 * ve o öğe etkin görünür (en uzun yol eşleşmesi).
 */
export type NavIcon = typeof LayoutDashboard;

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
};

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  module: AppModule;
  /** Birden çok sayfayı tek menü öğesinde toplar; ilk sekme öğenin girişidir. */
  tabs?: readonly NavTab[];
};

export type NavSection = {
  id: string;
  title: string;
  icon: NavIcon;
  items: NavItem[];
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "bugun",
    title: "Bugün",
    icon: ICONS.dashboard,
    items: [
      { href: "/app", label: "Ana ekran", icon: ICONS.dashboard, module: "dashboard" },
      { href: "/app/brifing", label: "Günlük Brifing", icon: Sunrise, module: "dashboard" },
      { href: "/app/baslangic", label: "Ofis kurulumu", icon: ListChecks, module: "dashboard" },
      { href: "/app/asistan", label: "AI Asistan", icon: ICONS.ai, module: "dashboard" },
    ],
  },
  {
    id: "musteriler",
    title: "Müşteriler",
    icon: ICONS.musteri,
    items: [
      { href: "/app/musteriler", label: "Müşteriler", icon: ICONS.musteri, module: "customers" },
      { href: "/app/talepler", label: "Talepler", icon: ICONS.talep, module: "demands" },
      { href: "/app/eslestirme", label: "Eşleştirme", icon: ICONS.eslestirme, module: "matching" },
      { href: "/app/akilli-listeler", label: "Akıllı Listeler", icon: ListFilter, module: "customers" },
      { href: "/app/tavsiyeler", label: "Tavsiyeler", icon: ICONS.tavsiye, module: "customers" },
    ],
  },
  {
    id: "portfoy",
    title: "Portföy",
    icon: ICONS.portfoy,
    items: [
      { href: "/app/portfoyler", label: "Portföyler", icon: ICONS.portfoy, module: "properties" },
      {
        href: "/app/kiralama",
        label: "Kiralama",
        icon: ICONS.anahtar,
        module: "rentals",
        // Kira artışı izin modülü `valuation` (kiralama `rentals`): sekme kendi modülüyle gizlenir/gösterilir.
        tabs: [
          { href: "/app/kiralama", label: "Kiralama", icon: ICONS.anahtar, module: "rentals" },
          { href: "/app/kira-artis", label: "Kira artışı", icon: ICONS.oran, module: "valuation" },
        ],
      },
      { href: "/app/projeler", label: "Projeler", icon: ICONS.proje, module: "projects" },
      { href: "/app/acik-ev", label: "Açık Ev", icon: ICONS.acikEv, module: "open_house" },
      { href: "/app/portallar", label: "Portal Kontrol", icon: ICONS.portal, module: "portals" },
      { href: "/app/portfoyler/anahtarlar", label: "Anahtar Takibi", icon: KeySquare, module: "properties" },
      { href: "/app/portfoyler/sunumlar", label: "Sunumlar", icon: Presentation, module: "properties" },
      { href: "/app/ag", label: "Ofisler Arası Ağ", icon: ICONS.ag, module: "network" },
    ],
  },
  {
    id: "anlasmalar",
    title: "Anlaşmalar",
    icon: ICONS.anlasma,
    items: [
      { href: "/app/anlasmalar", label: "Anlaşmalar", icon: ICONS.anlasma, module: "commissions" },
      { href: "/app/teklifler", label: "Teklifler", icon: ICONS.teklif, module: "offers" },
      { href: "/app/sozlesmeler", label: "Sözleşmeler", icon: ICONS.sozlesme, module: "contracts" },
    ],
  },
  {
    id: "iletisim",
    title: "İletişim",
    icon: ICONS.gelenKutusu,
    items: [
      { href: "/app/gelen-kutusu", label: "Gelen Kutusu", icon: ICONS.gelenKutusu, module: "calls" },
      { href: "/app/arama", label: "Akıllı Arama", icon: ICONS.telefon, module: "calls" },
      { href: "/app/randevular", label: "Randevular", icon: ICONS.randevu, module: "appointments" },
      { href: "/app/gorevler", label: "Görevler", icon: ICONS.gorev, module: "tasks" },
      { href: "/app/kampanyalar", label: "Kampanyalar", icon: ICONS.mesaj, module: "campaigns" },
    ],
  },
  {
    id: "finans",
    title: "Finans",
    icon: ICONS.komisyon,
    items: [
      {
        href: "/app/komisyon",
        label: "Komisyon",
        icon: ICONS.komisyon,
        module: "commissions",
        tabs: [
          { href: "/app/komisyon", label: "Komisyon", icon: ICONS.komisyon, module: "commissions" },
          { href: "/app/cuzdan", label: "Cüzdanım", icon: ICONS.cuzdan, module: "commissions" },
          { href: "/app/onaylar", label: "Onaylar", icon: BadgeCheck, module: "commissions" },
            ],
      },
      { href: "/app/giderler", label: "Giderler", icon: ICONS.gider, module: "expenses" },
      { href: "/app/aidat", label: "Aidat", icon: ICONS.aidat, module: "expenses" },
    ],
  },
  {
    id: "performans",
    title: "Performans",
    icon: ICONS.rapor,
    items: [
      { href: "/app/raporlar", label: "Raporlar", icon: ICONS.rapor, module: "reports" },
      { href: "/app/kayip-kacak", label: "Kayıp-kaçak", icon: ICONS.alarm, module: "leak" },
      {
        href: "/app/danisman-kpi",
        label: "Ekip performansı",
        icon: ICONS.kpi,
        module: "reports",
        tabs: [
          { href: "/app/danisman-kpi", label: "Danışman KPI", icon: ICONS.kpi, module: "reports" },
          { href: "/app/lig", label: "Ekip Ligi", icon: Trophy, module: "reports" },
        ],
      },
      { href: "/app/bolge-analizi", label: "Bölge Analizi", icon: ICONS.bolge, module: "reports" },
      { href: "/app/kayip-satis", label: "Kayıp Satış", icon: ICONS.dusus, module: "customers" },
      { href: "/app/pano-tv", label: "Ofis Panosu (TV)", icon: Tv, module: "reports" },
    ],
  },
  {
    id: "araclar",
    title: "Araçlar",
    icon: ICONS.skor,
    items: [
      { href: "/app/degerleme", label: "Değerleme", icon: ICONS.skor, module: "valuation" },
      // Alım maliyeti + yatırım getirisi: tek sayfa, ?sekme= ile iki sekme.
      { href: "/app/hesaplayici", label: "Hesaplayıcılar", icon: Calculator, module: "valuation" },
      { href: "/app/yabanci-satis", label: "Yabancıya Satış", icon: Globe, module: "properties" },
    ],
  },
  {
    id: "ofis",
    title: "Ofis",
    icon: ICONS.ayar,
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
          { href: "/app/ekip/kiyas", label: "Kıyas", icon: ICONS.kpi, module: "reports" },
          { href: "/app/ekip/kazanc", label: "Kazanç", icon: ICONS.cuzdan, module: "commissions" },
          { href: "/app/hedefler", label: "Hedefler", icon: ICONS.hedef, module: "targets" },
          { href: "/app/ekip/devir", label: "Devir / Atama", icon: ArrowLeftRight, module: "team" },
        ],
      },
      { href: "/app/otomasyonlar", label: "Otomasyonlar", icon: ICONS.otomasyon, module: "settings" },
      { href: "/app/ayarlar/is-akislari", label: "İş Akışları", icon: Workflow, module: "settings" },
      { href: "/app/uyum", label: "Uyum", icon: ICONS.uyum, module: "compliance" },
      { href: "/app/belgeler", label: "Belge Merkezi", icon: ICONS.belge, module: "settings" },
      { href: "/app/denetim", label: "Denetim", icon: ICONS.denetim, module: "settings" },
      { href: "/app/abonelik", label: "Abonelik ve paket", icon: ICONS.abonelik, module: "billing" },
      { href: "/app/destek", label: "Destek", icon: ICONS.destek, module: "support" },
      { href: "/app/ayarlar", label: "Ayarlar", icon: ICONS.ayar, module: "settings" },
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
};

/** Sekmeli öğeyi erişilebilir sekmelere indirger; hiç sekme kalmazsa null. */
function visibleItem(item: NavItem, accessible: readonly AppModule[]): NavItem | null {
  if (!item.tabs) return accessible.includes(item.module) ? item : null;
  const tabs = item.tabs.filter((t) => accessible.includes(t.module));
  const first = tabs[0];
  if (!first) return null;
  return { ...item, href: first.href, module: first.module, tabs };
}

/** Erişilebilir modüllere göre görünen başlıklar; her başlığın girişi ilk görünen sayfasıdır. */
export function visibleSections(accessible: readonly AppModule[]): VisibleSection[] {
  return NAV_SECTIONS.map((section) => {
    const items = section.items.flatMap((item) => visibleItem(item, accessible) ?? []);
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
