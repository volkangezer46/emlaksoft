import type { LucideIcon } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { findActiveNavigationHref } from "@/lib/navigation";
import type { AppModule } from "@/lib/permissions";
import { coreHrefsFor, isHiddenInSimple } from "@/lib/nav-roles";

/**
 * /app menüsünün TEK kaynağı. 55 düz link yerine 9 iş başlığı: kullanıcı önce
 * "ne yapıyorum" (bugün, müşteri, portföy, anlaşma…) seçer, sonra başlığın
 * içindeki sayfaya gider. Sayfa yolları DEĞİŞMEZ; hiçbir sayfa silinmedi, eski
 * bağlantılar ve yer imleri çalışır. Menüde görünmeyen alt sayfalar (ör.
 * /app/ayarlar/filigran, /app/ekip/izinler) bağlı oldukları öğenin içindedir
 * ve o öğe etkin görünür (en uzun yol eşleşmesi).
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
};

export type NavTier = "core" | "more";

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
    icon: ICONS.baslikBugun,
    items: [
      { href: "/app", label: "Ana ekran", icon: ICONS.dashboard, module: "dashboard", tier: "core" },
      { href: "/app/baslangic", label: "Ofis kurulumu", icon: ICONS.kurulum, module: "dashboard", tier: "more" },
      { href: "/app/asistan", label: "AI Asistan", icon: ICONS.ai, module: "dashboard", tier: "more" },
    ],
  },
  {
    id: "musteriler",
    title: "Müşteriler",
    icon: ICONS.baslikMusteri,
    items: [
      { href: "/app/musteriler", label: "Müşteriler", icon: ICONS.musteri, module: "customers", tier: "core" },
      // Talepler sayfasının ikinci sekmesi "Eşleşme" (matching izniyle gizlenir); /app/eslestirme yönlendirir.
      { href: "/app/talepler", label: "Talepler", icon: ICONS.talep, module: "demands", tier: "core" },
      { href: "/app/akilli-listeler", label: "Akıllı Listeler", icon: ICONS.akilliListe, module: "customers", tier: "more" },
      { href: "/app/tavsiyeler", label: "Tavsiyeler", icon: ICONS.tavsiye, module: "customers", tier: "more" },
      { href: "/app/kayip-satis", label: "Kayıp nedenleri", icon: ICONS.dusus, module: "customers", tier: "more" },
    ],
  },
  {
    id: "portfoy",
    title: "Portföy",
    icon: ICONS.baslikPortfoy,
    items: [
      { href: "/app/portfoyler", label: "Portföyler", icon: ICONS.portfoy, module: "properties", tier: "core" },
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
        tier: "more",
      },
      { href: "/app/projeler", label: "Projeler", icon: ICONS.proje, module: "projects", tier: "more" },
      { href: "/app/acik-ev", label: "Açık Ev", icon: ICONS.acikEv, module: "open_house", tier: "more" },
      { href: "/app/portallar", label: "Portal Kontrol", icon: ICONS.portal, module: "portals", tier: "more" },
      { href: "/app/portfoyler/anahtarlar", label: "Anahtar Takibi", icon: ICONS.anahtarTakip, module: "properties", tier: "more" },
      { href: "/app/portfoyler/sunumlar", label: "Sunumlar", icon: ICONS.sunum, module: "properties", tier: "more" },
      { href: "/app/ag", label: "Ofisler Arası Ağ", icon: ICONS.ag, module: "network", tier: "more" },
    ],
  },
  {
    id: "anlasmalar",
    title: "Anlaşmalar",
    icon: ICONS.baslikAnlasma,
    items: [
      { href: "/app/anlasmalar", label: "Anlaşmalar", icon: ICONS.anlasma, module: "commissions", tier: "core" },
      { href: "/app/teklifler", label: "Teklifler", icon: ICONS.teklif, module: "offers", tier: "more" },
      { href: "/app/sozlesmeler", label: "Sözleşmeler", icon: ICONS.sozlesme, module: "contracts", tier: "more" },
    ],
  },
  {
    id: "iletisim",
    title: "İletişim",
    icon: ICONS.baslikIletisim,
    items: [
      // İkinci sekme "Çağrı kaydı" (eski /app/arama, yönlendirir): iki sekme de `calls` modülünde.
      { href: "/app/gelen-kutusu", label: "Gelen Kutusu", icon: ICONS.gelenKutusu, module: "calls", tier: "core" },
      { href: "/app/randevular", label: "Randevular", icon: ICONS.randevu, module: "appointments", tier: "core" },
      { href: "/app/gorevler", label: "Görevler", icon: ICONS.gorev, module: "tasks", tier: "core" },
      { href: "/app/kampanyalar", label: "Kampanyalar", icon: ICONS.mesaj, module: "campaigns", tier: "more" },
    ],
  },
  {
    id: "finans",
    title: "Finans",
    icon: ICONS.baslikFinans,
    items: [
      {
        href: "/app/komisyon",
        label: "Komisyon",
        icon: ICONS.komisyon,
        module: "commissions",
        tabs: [
          { href: "/app/komisyon", label: "Komisyon", icon: ICONS.komisyon, module: "commissions" },
          { href: "/app/cuzdan", label: "Kazanç", icon: ICONS.cuzdan, module: "commissions" },
          { href: "/app/onaylar", label: "Onaylar", icon: ICONS.onay, module: "commissions" },
            ],
        tier: "core",
      },
      { href: "/app/giderler", label: "Giderler", icon: ICONS.gider, module: "expenses", tier: "core" },
      { href: "/app/aidat", label: "Aidat", icon: ICONS.aidat, module: "expenses", tier: "core" },
    ],
  },
  {
    id: "performans",
    title: "Performans",
    icon: ICONS.baslikPerformans,
    items: [
      // Kişinin kendi karnesi, hedefi ve kazancı (danışman rolünde Ekip Merkezi yerine bu giriş vardır).
      { href: "/app/performansim", label: "Performansım", icon: ICONS.rozet, module: "dashboard", tier: "core" },
      {
        // Raporlar kabuğu: yollar sabit, her sekme kendi sayfasının kapısını (ve paket kilidini) korur.
        href: "/app/raporlar",
        label: "Raporlar",
        icon: ICONS.rapor,
        module: "reports",
        tabs: [
          { href: "/app/raporlar", label: "Ofis", icon: ICONS.rapor, module: "reports" },
          { href: "/app/bolge-analizi", label: "Bölge", icon: ICONS.bolge, module: "reports" },
          { href: "/app/raporlar/talep-arz", label: "Talep-arz", icon: ICONS.talepArz, module: "reports" },
          { href: "/app/raporlar/memnuniyet", label: "Memnuniyet", icon: ICONS.memnuniyet, module: "reports" },
          { href: "/app/franchise", label: "Şube", icon: ICONS.sube, module: "reports" },
        ],
        tier: "core",
      },
      { href: "/app/kayip-kacak", label: "Kaçan komisyonlar", icon: ICONS.alarm, module: "leak", tier: "more" },
      { href: "/app/pano-tv", label: "Ofis Panosu (TV)", icon: ICONS.panoTv, module: "reports", tier: "more" },
    ],
  },
  {
    id: "araclar",
    title: "Araçlar",
    icon: ICONS.baslikArac,
    items: [
      { href: "/app/degerleme", label: "Değerleme", icon: ICONS.skor, module: "valuation", tier: "core" },
      // Alım maliyeti + yatırım getirisi: tek sayfa, ?sekme= ile iki sekme.
      { href: "/app/hesaplayici", label: "Hesaplayıcılar", icon: ICONS.hesaplayici, module: "valuation", tier: "more" },
      { href: "/app/yabanci-satis", label: "Yabancıya Satış", icon: ICONS.yabanciSatis, module: "properties", tier: "more" },
    ],
  },
  {
    id: "ofis",
    title: "Ofis",
    icon: ICONS.baslikOfis,
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
          { href: "/app/ekip/kiyas", label: "Kıyas", icon: ICONS.kiyas, module: "reports" },
          { href: "/app/danisman-kpi", label: "Danışman KPI", icon: ICONS.kpi, module: "reports" },
          { href: "/app/lig", label: "Ekip Ligi", icon: ICONS.lig, module: "reports" },
          { href: "/app/hedefler", label: "Hedefler", icon: ICONS.hedef, module: "targets" },
          { href: "/app/ekip/devir", label: "Devir / Atama", icon: ICONS.devir, module: "team" },
          { href: "/app/ekip/subeler", label: "Şubeler", icon: ICONS.ekip, module: "team" },
        ],
        // Ekip Merkezi ekip modülü olanın girişidir; modülsüz rolde (danışman) yerine Performansım vardır.
        needsItemModule: true,
        tier: "core",
      },
      {
        // Otomasyon: kurallar + iş akışları (motorlar ayrı kalır, yalnız sayfa düzeyinde tek öğe).
        href: "/app/otomasyonlar",
        label: "Otomasyon",
        icon: ICONS.otomasyon,
        module: "settings",
        tabs: [
          { href: "/app/otomasyonlar", label: "Kurallar", icon: ICONS.otomasyon, module: "settings" },
          { href: "/app/ayarlar/is-akislari", label: "İş akışları", icon: ICONS.isAkisi, module: "settings" },
        ],
        tier: "more",
      },
      { href: "/app/uyum", label: "Uyum", icon: ICONS.uyum, module: "compliance", tier: "more" },
      { href: "/app/belgeler", label: "Belge Merkezi", icon: ICONS.belge, module: "settings", tier: "more" },
      { href: "/app/denetim", label: "Denetim", icon: ICONS.denetim, module: "settings", tier: "more" },
      { href: "/app/abonelik", label: "Abonelik ve paket", icon: ICONS.abonelik, module: "billing", tier: "core" },
      {
        // Yardım ve Destek: tek menü öğesi; yardım merkezi + mevcut destek talepleri sekme.
        href: "/app/yardim",
        label: "Yardım ve Destek",
        icon: ICONS.destek,
        module: "support",
        tier: "core",
        tabs: [
          { href: "/app/yardim", label: "Yardım", icon: ICONS.destek, module: "support" },
          { href: "/app/destek", label: "Destek talepleri", icon: ICONS.destek, module: "support" },
        ],
      },
      { href: "/app/ayarlar", label: "Ayarlar", icon: ICONS.ayar, module: "settings", tier: "more" },
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

/** Sekmeli öğeyi erişilebilir sekmelere indirger; hiç sekme kalmazsa null. */
function visibleItem(item: NavItem, accessible: readonly AppModule[]): NavItem | null {
  if (!item.tabs) return accessible.includes(item.module) ? item : null;
  if (item.needsItemModule && !accessible.includes(item.module)) return null;
  const tabs = item.tabs.filter((t) => accessible.includes(t.module));
  const first = tabs[0];
  if (!first) return null;
  return { ...item, href: first.href, module: first.module, tabs };
}

/** "full": tüm yetkili sayfalar. "simple": yalnız rolün çekirdek sayfaları (gerisi `moreSections`). */
export type NavMode = "simple" | "full";
export type NavViewOptions = { mode?: NavMode; role?: string | null };

/**
 * Erişilebilir modüllere göre görünen başlıklar; her başlığın girişi ilk görünen sayfasıdır.
 * `mode: "simple"` yalnız GÖRÜNÜRLÜĞÜ daraltır (yetki matrisi aynı): rolün çekirdek öğeleri kalır.
 */
export function visibleSections(accessible: readonly AppModule[], opts: NavViewOptions = {}): VisibleSection[] {
  const core = opts.mode === "simple" ? coreHrefsFor(opts.role) : null;
  return NAV_SECTIONS.map((section) => {
    const items = section.items.flatMap((item) =>
      core && !core.has(item.href) ? [] : (visibleItem(item, accessible) ?? []),
    );
    return { ...section, items, href: items[0]?.href ?? "/app" };
  }).filter((section) => section.items.length > 0);
}

/**
 * Sade görünümde "Daha fazla" altına inen yetkili öğeler (çekirdek dışı). Yönetici olmayan rollerde
 * yönetim sayfaları (Ayarlar, Otomasyon…) burada da yer almaz; tam görünümde ve doğrudan adreste durur.
 */
export function moreSections(accessible: readonly AppModule[], opts: { role?: string | null } = {}): VisibleSection[] {
  const core = coreHrefsFor(opts.role);
  return NAV_SECTIONS.map((section) => {
    const items = section.items.flatMap((item) =>
      core.has(item.href) || isHiddenInSimple(opts.role, item.href) ? [] : (visibleItem(item, accessible) ?? []),
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
