import type { LucideIcon } from "lucide-react";
import type { PlatformModule } from "@/lib/platform-access";

/**
 * /admin menüsünün VERİSİZ çekirdeği: tipler + saf kurallar (görünürlük, etkin öğe, sekme seçimi, mobil yuvalar).
 * Katalog (`ADMIN_NAV`, ikonlar ve açıklamalar) `nav.ts`'tedir ve istemci paketine girmez: kabuk (sunucu) kataloğu düz
 * veri olarak verir (`nav-client-catalog.ts`), istemci bileşenleri aynı kuralları `bindAdminNav(katalog)` ile çalıştırır.
 * `nav.ts` aynı fonksiyonları `ADMIN_NAV`'a bağlı olarak dışa aktarır (tek uygulama, iki veri kaynağı).
 * Bu dosya lucide/katalog DEĞERİ içe aktarmaz (yalnız tip): istemci ilk yük paketine katalog sızmasın.
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

/** `I`: ikon tipi — katalogda lucide bileşeni, sunucudan istemciye giden düz veride `ShellIcon` (nav-shell). */
export type AdminNavLink<I = LucideIcon> = {
  href: string;
  label: string;
  description: string;
  modules: readonly PlatformModule[];
  /** Sekmenin alt sayfaları: sekme etkinken şeridin İKİNCİ satırında çizilir (ör. Hız > Genel · Saha · Laboratuvar). */
  children?: readonly AdminNavLink<I>[];
  /** Sekmeyi her zaman "Diğer ▾" altına koy (5 görünür sekme kuralından bağımsız). */
  overflow?: boolean;
  /** Ek görünürlük koşulu (ör. kupon şeması kurulu değilse Kuponlar sekmesi çizilmez); bkz. `AdminNavConditions`. */
  when?: AdminNavCondition;
  /**
   * Sekme şeridindeki ikon (yalnız istemci kataloğunda; sunucuda `lib/admin/tab-icons.ts` ile çözülür). Yoksa şerit
   * menü öğesinin ikonunu kullanır.
   */
  tabIcon?: I;
};

/** Modül dışı görünürlük koşulları: kabuk (sunucu) hesaplar, sekme şeridine verir. Verilmeyen koşul sağlanmış sayılır. */
export type AdminNavCondition = "coupons";
export type AdminNavConditions = Partial<Record<AdminNavCondition, boolean>>;

/** Bölüm sekmesi (sekme şeridi ve komut paleti). */
export type NavTab<I = LucideIcon> = AdminNavLink<I>;

export type AdminNavItem<I = LucideIcon> = AdminNavLink<I> & {
  icon: I;
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
  tabs?: readonly AdminNavLink<I>[];
  palette?: readonly AdminNavLink<I>[];
};

export type AdminNavSection<I = LucideIcon> = {
  id: string;
  title: string;
  items: readonly AdminNavItem<I>[];
  /** Menü yönetiminden gizlenemez (Genel bakış, Yönetim). */
  required?: boolean;
};

/** Menü yönetimi (platform ayarı) admin yan menüsü kısmı: seyrek fark; bilinmeyen grup kimliği yok sayılır. */
export type AdminNavOverrides = { hiddenGroups?: readonly string[]; groupOrder?: readonly string[] };

export const canSee = (link: Pick<AdminNavLink, "modules" | "when">, allowed: readonly PlatformModule[], conditions: AdminNavConditions = {}) =>
  link.modules.some((m) => allowed.includes(m)) && (!link.when || conditions[link.when] !== false);

/**
 * Sıfır çıkmaz: öğenin kendi sekmesi (href'i) rolde görünmüyorsa satır ilk GÖRÜNÜR sekmeye gider (ör. yalnız `veri`
 * modülü olan özel rol "Sistem durumu"na tıklayınca `sistem` kapısından /admin'e geri atılmaz, Veri gezgini açılır).
 * Kök /admin herkesin iniş sayfasıdır; değiştirilmez.
 */
const reachableHref = <I>(item: AdminNavItem<I>, tabs: readonly AdminNavLink<I>[] | undefined): string => {
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

/** Sekmenin şeritteki anahtarı: `?sekme=` taşıyan sekmede tam adres, diğerlerinde yol (bkz. activeTabHref). */
export const tabKey = (href: string): string => (sekmeOf(href) ? href : pathOf(href));

/**
 * Sekme aktif mi: en uzun eşleşen yol kazanır (/admin/ayarlar/yasal/[slug], /admin/ayarlar/yasal sekmesini etkin yapar). Alt sayfalar (`children`)
 * da sekmenin yoludur: /admin/site/sayfalar "İçerik" sekmesini etkin yapar ("Genel bakış" /admin/site'ı değil).
 * Sorgu sekmesi: href'i `?sekme=X` taşıyan sekme (ör. "Hata kayıtları" = `/admin/sistem?sekme=hatalar`) yalnız aynı yolda
 * `sekme` X iken etkindir ve yol eşleşmesinden önce gelir; o zaman tam href döner (yol sekmesi etkin görünmez).
 */
export function activeTabHref<I>(pathname: string, tabs: readonly AdminNavLink<I>[], sekme?: string | null): string | null {
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

export function activeChildHref<I>(pathname: string, tab: AdminNavLink<I> | null | undefined): string | null {
  return tab?.children?.length ? activeTabHref(pathname, tab.children) : null;
}

/** En çok 5 görünür sekme; kalanlar ve `overflow` işaretliler "Diğer ▾" altına girer. */
export const MAX_VISIBLE_TABS = 5;

export function splitTabs<L extends AdminNavLink<unknown>>(tabs: readonly L[], max = MAX_VISIBLE_TABS): { visible: L[]; more: L[] } {
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
export function adminTabPrefetchTargets<I>(tabs: readonly AdminNavLink<I>[], current: string | null, max = ADMIN_TAB_PREFETCH_MAX): string[] {
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

export type AdminSidebarGroup<I = LucideIcon> = { section: AdminNavSection<I>; items: AdminNavItem<I>[] };
export type AdminSidebarModel<I = LucideIcon> = { groups: AdminSidebarGroup<I>[]; dock: AdminNavItem<I>[] };

/**
 * Katalog bağımlı kurallar: verilen kataloğa (sunucuda `ADMIN_NAV`, istemcide kabuğun verdiği düz veri) bağlanır.
 * `nav.ts` bunları `ADMIN_NAV` ile dışa aktarır; istemci bileşenleri `useAdminNav(katalog)` ile aynı adları kullanır.
 */
export function bindAdminNav<I>(catalog: readonly AdminNavSection<I>[]) {
  /** Role (ve koşullara) göre görünür menü (boş bölümler atılır; sekmeler de role göre süzülür; menü yönetimi farkı uygulanır). */
  function adminNavFor(allowed: readonly PlatformModule[], conditions: AdminNavConditions = {}, overrides?: AdminNavOverrides | null): AdminNavSection<I>[] {
    const sections = catalog
      .map((s) => ({
        ...s,
        items: s.items
          .filter((i) => canSee(i, allowed, conditions))
          .map((i) => {
            const tabs = i.tabs
              ?.filter((t) => canSee(t, allowed, conditions))
              .map((t) => (t.children ? { ...t, children: t.children.filter((c) => canSee(c, allowed, conditions)) } : t));
            return { ...i, href: reachableHref(i, tabs), tabs };
          }),
      }))
      .filter((s) => s.items.length > 0);
    return applyAdminNavOverrides(sections, overrides);
  }

  /**
   * Bulunulan sayfanın menü öğesi (yan menü vurgusu, sekme şeridi ve başlık için). Önce `?sekme=` öğeleri (Entegrasyonlar),
   * sonra yol öğeleri: /admin/sistem?sekme=entegrasyonlar "Sistem durumu"nu değil Entegrasyonlar'ı etkin yapar. Yalnız
   * `veri` modülü olan rolde Sistem durumu satırı Veri gezginine gider ve sekme öğesi gibi eşleşir.
   */
  function activeAdminItem(pathname: string, sections: readonly AdminNavSection<I>[] = catalog, sekme?: string | null): AdminNavItem<I> | null {
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

  /**
   * Mobil alt çubuk öğeleri (B145): menü sırasının ilk 4 öğesi DEĞİL, mobil önceliği. Seçim sırası: (1) `mobileTab`
   * işaretliler (Kontrol paneli, Ofisler, Talepler, Sistem durumu: gece işi ve kuyruk), (2) rozet taşıyan öğeler,
   * (3) diğerleri; seçilenler menü sırasıyla çizilir (yer değiştirmez). Rol görmediği öğeyi almaz: yalnız `adminNavFor`
   * süzgecinden geçenler. Rozet sayısı yerine rozet ANAHTARI kullanılır: sayı akışla gelir, çubuk sonradan yer
   * değiştirmesin (CLS yok). Alt sabit (dock) öğeler alt çubuğa girmez.
   */
  function adminMobileTabs(allowed: readonly PlatformModule[], slots = ADMIN_MOBILE_TAB_SLOTS): AdminNavItem<I>[] {
    const ordered = adminNavFor(allowed).flatMap((s) => s.items).filter((i) => !i.dock);
    const rank = (i: AdminNavItem<I>) => (i.mobileTab ? 0 : i.badgeKey ? 1 : 2);
    const picked = new Set(
      ordered
        .map((item, index) => ({ item, index }))
        .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
        .slice(0, slots)
        .map((x) => x.item.href),
    );
    return ordered.filter((i) => picked.has(i.href));
  }

  /**
   * Yan menü görünümü: her grup kendi başlığıyla, TÜM öğeleriyle (gizli "+N daha" yok); grup satır içi açılır alandır
   * (akordeon, istemci durumu). Alt sabit (`dock`) öğeler gruptan çıkar, alt bölümde çizilir. Boş grup çizilmez.
   */
  function adminSidebarModel(allowed: readonly PlatformModule[], conditions: AdminNavConditions = {}, overrides?: AdminNavOverrides | null): AdminSidebarModel<I> {
    const sections = adminNavFor(allowed, conditions, overrides);
    const dock = sections.flatMap((s) => s.items.filter((i) => i.dock));
    const groups = sections
      .map((section) => ({ section, items: section.items.filter((i) => !i.dock) }))
      .filter((g) => g.items.length > 0);
    return { groups, dock };
  }

  return { adminNavFor, activeAdminItem, adminMobileTabs, adminSidebarModel };
}
