import type { LucideIcon } from "lucide-react";
import { hubNav, navExtraPathOwners, NAV_SHORTCUTS, type HubNavModel, type HubPage, type NavHub } from "@/lib/nav-config";
import { isManagementRole } from "@/lib/nav-roles";
import { APP_ACTIONS, getAppActions } from "@/lib/palette-core";
import type { AppModule } from "@/lib/permissions";
import type {
  ResolvableNav,
  ShellAction,
  ShellHub,
  ShellIcon,
  ShellIconNode,
  ShellNav,
  ShellNavSet,
  ShellPage,
  ShellShortcut,
} from "@/lib/nav-shell";

/**
 * /app kabuk modelinin SUNUCU tarafı: menü kataloğu, rol düzenleri, ikon sözlüğü ve palet eylemleri burada (layout'ta)
 * çözülür; istemciye `nav-shell.ts` düz verisi gider. Böylece bu modüller /app ilk yük paketine girmez.
 * Yalnız sunucu bileşenlerinden çağrılır (istemci dosyası bunu import ETMEZ: client-bundle sözleşmesi).
 */

const ICON_CACHE = new Map<LucideIcon, ShellIcon>();

type LucideRender = { render: (props: object, ref: null) => { props: { iconNode: ShellIconNode; className: string } } };

/**
 * lucide bileşeninden çizim verisi: bileşenin kendi render'ı çağrılıp `Icon`'a verdiği `iconNode` ve sınıf adları
 * okunur (lucide-react 1.x `createLucideIcon`). İstemcide lucide `Icon` aynı veriyle çağrılır → SVG birebir aynıdır.
 */
export function shellIcon(icon: LucideIcon): ShellIcon {
  const hit = ICON_CACHE.get(icon);
  if (hit) return hit;
  const el = (icon as unknown as LucideRender).render({}, null);
  const node = el?.props?.iconNode;
  const cls = el?.props?.className;
  if (!Array.isArray(node) || typeof cls !== "string") throw new Error("shellIcon: lucide ikonu çözümlenemedi");
  const out: ShellIcon = { cls, node };
  ICON_CACHE.set(icon, out);
  return out;
}

/**
 * Aynı içerikli sayfa/merkez nesneleri TEK nesne olarak paylaşılır (istek başına): RSC yükü yinelenen nesneyi
 * yalnız bir kez yazar ("$id:yol" başvurusu); kendi düzeni, kişisel düzen ve ofis yöneticisi düzeni büyük ölçüde aynıdır.
 */
type Interner = Map<string, ShellPage | ShellHub>;

/**
 * `withDescription`: açıklama yalnız görünen yerde taşınır (tek sayfalı merkezin ve Araçlar satırının `title` ipucu);
 * çok sayfalı merkezin ipucu sayfa adlarından kurulur, açıklamalar komut paletinde (tembel parça) kalır.
 */
function page(p: HubPage, memo: Interner, withDescription: boolean): ShellPage {
  const description = withDescription ? p.description : undefined;
  const key = `p|${p.href}|${p.label}|${description ?? ""}|${p.itemHref}|${shellIcon(p.icon).cls}`;
  const hit = memo.get(key) as ShellPage | undefined;
  if (hit) return hit;
  const out: ShellPage = { href: p.href, label: p.label, icon: shellIcon(p.icon), ...(description ? { description } : {}), itemHref: p.itemHref };
  memo.set(key, out);
  return out;
}

function hub(h: NavHub, memo: Interner): ShellHub {
  const pages = h.pages.map((p) => page(p, memo, h.pages.length === 1));
  const key = `h|${h.id}|${h.label}|${h.group ?? ""}|${h.short ?? ""}|${h.href}|${shellIcon(h.icon).cls}|${pages.map((p) => `${p.href}~${p.label}~${p.description ?? ""}`).join(",")}`;
  const hit = memo.get(key) as ShellHub | undefined;
  if (hit) return hit;
  const out: ShellHub = {
    id: h.id,
    label: h.label,
    icon: shellIcon(h.icon),
    ...(h.group ? { group: h.group } : {}),
    ...(h.short ? { short: h.short } : {}),
    href: h.href,
    pages,
  };
  memo.set(key, out);
  return out;
}

export function toShellNav(nav: HubNavModel, memo: Interner = new Map()): ShellNav {
  return {
    hubs: nav.hubs.map((h) => hub(h, memo)),
    dock: nav.dock.map((h) => hub(h, memo)),
    tools: nav.tools.map((p) => page(p, memo, true)),
    mobile: [...nav.mobile],
  };
}

/**
 * Kabuğun bütün menü düzenleri (yan menü, kırıntı, sekme şeridi aynı nesneyi paylaşır). `role` görünen roldür
 * (platform personeli "owner"); yönetim rolünde "Benim işlerim" için danışman düzeni de hazırlanır.
 */
export function buildShellNavSet(input: { accessible: readonly AppModule[]; closed: readonly string[]; role: string | null }): ShellNavSet {
  const { accessible, closed, role } = input;
  const memo: Interner = new Map();
  const own = toShellNav(hubNav(accessible, { role, closed }), memo);
  const personal = isManagementRole(role) ? toShellNav(hubNav(accessible, { role: "advisor", closed }), memo) : null;
  const owner = role === "owner" ? own : toShellNav(hubNav(accessible, { role: "owner", closed }), memo);
  return { own, personal, owner, extra: navExtraPathOwners() };
}

/** Sekme şeridi iskeleti: TAM erişimde ofis yöneticisi düzeni (yalnız yollar; etiket/ikon taşımaz). */
export function buildPlaceholderNav(allModules: readonly AppModule[]): ResolvableNav {
  const nav = hubNav(allModules, { role: "owner" });
  const strip = (hs: readonly NavHub[]) => hs.map((h) => ({ pages: h.pages.map((p) => ({ href: p.href })) }));
  return { hubs: strip(nav.hubs), dock: strip(nav.dock), tools: nav.tools.map((t) => ({ href: t.href })) };
}

/** Hızlı oluşturma eylemleri (yan menü ikon modu açılır paneli, mobil "+ Yeni"): palette-core `getAppActions` ile aynı süzgeç. */
export function buildShellActions(creatable: readonly AppModule[], locked: readonly string[], closed: readonly string[]): ShellAction[] {
  return getAppActions(creatable, "", locked, closed).map((a) => ({
    label: a.label,
    href: a.href,
    icon: shellIcon(a.icon),
    ...(a.shortcut ? { shortcut: a.shortcut } : {}),
  }));
}

/** Klavye kısayolları: `g` (nav-config NAV_SHORTCUTS) ve `n` (palette-core APP_ACTIONS.shortcut) dizileri. */
export function buildShortcuts(): { go: ShellShortcut[]; create: ShellShortcut[] } {
  return {
    go: NAV_SHORTCUTS.map((k) => ({ tuslar: k.keys, hedef: k.href, etiket: k.label })),
    create: APP_ACTIONS.flatMap((a) => (a.shortcut ? [{ tuslar: a.shortcut, hedef: a.href, etiket: a.label }] : [])),
  };
}
