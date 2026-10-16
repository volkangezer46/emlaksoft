import { ADMIN_NAV, type AdminNavOverrides } from "@/lib/admin/nav";
import { NAV_LAYOUT_BY_KEY, NAV_LAYOUT_KEYS, REQUIRED_HUB_IDS, pageKey, type NavLayoutKey, type NavOverrides, type RoleNavOverride, type RoleNav } from "@/lib/nav-roles";

/**
 * Menü yönetimi ayarının (platform.nav_menu_overrides) SAF çözücüsü: bozuk/bilinmeyen her şey sessizce atılır (asla
 * fırlatmaz), varsayılanla aynı olan fark yazılmaz (seyrek). Ofis düzenlerinde geçerli anahtarlar varsayılan düzenden
 * (`NAV_LAYOUT_BY_KEY`), admin gruplarında `ADMIN_NAV`'dan türer; zorunlu merkez ve gruplar gizlenemez.
 */
export type MenuOverrides = NavOverrides & { admin?: AdminNavOverrides };

export const EMPTY_MENU_OVERRIDES: MenuOverrides = {};

const LABEL_MAX = 40;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const uniq = (xs: readonly string[]) => [...new Set(xs)];

/** Düzenin ayarlanabilir anahtarları: merkezler, sayfa anahtarları, grup adları ve varsayılan adlar. */
export function layoutCatalog(layout: RoleNav) {
  const hubs = [...layout.hubs, ...layout.dock];
  const hubIds = new Set(hubs.map((h) => h.id));
  const pageKeys = new Set(hubs.flatMap((h) => h.pages.map((pg) => pageKey(h.id, pg.href))));
  const groups = new Set(layout.hubs.flatMap((h) => (h.group ? [h.group] : [])));
  // Zorunlu merkezin ilk sayfası gizlenemez.
  const lockedPages = new Set(hubs.filter((h) => REQUIRED_HUB_IDS.includes(h.id) && h.pages[0]).map((h) => pageKey(h.id, h.pages[0]!.href)));
  const defaultLabels = new Map<string, string>();
  for (const h of hubs) {
    defaultLabels.set(h.id, h.label);
    for (const pg of h.pages) if (pg.label) defaultLabels.set(pageKey(h.id, pg.href), pg.label);
  }
  return { hubIds, pageKeys, groups, lockedPages, defaultLabels, mainIds: layout.hubs.map((h) => h.id) };
}

function parseRole(raw: unknown, layout: RoleNav): RoleNavOverride | null {
  if (!isObj(raw)) return null;
  const cat = layoutCatalog(layout);
  const hidden = uniq(strs(raw.hidden)).filter((k) => (cat.hubIds.has(k) && !REQUIRED_HUB_IDS.includes(k)) || (cat.pageKeys.has(k) && !cat.lockedPages.has(k)));
  const hiddenGroups = uniq(strs(raw.hiddenGroups)).filter((g) => cat.groups.has(g));
  const orderIn = uniq(strs(raw.order)).filter((id) => cat.mainIds.includes(id));
  // Varsayılan sırayla aynıysa sıra yazılmaz (seyrek fark).
  const order = orderIn.length > 0 && orderIn.join("|") !== cat.mainIds.filter((id) => orderIn.includes(id)).join("|") ? orderIn : [];
  const labels: Record<string, string> = {};
  if (isObj(raw.labels)) {
    for (const [k, v] of Object.entries(raw.labels)) {
      if (typeof v !== "string" || !(cat.hubIds.has(k) || cat.pageKeys.has(k))) continue;
      const t = v.trim().replace(/\s+/g, " ");
      if (!t || t.length > LABEL_MAX || t === cat.defaultLabels.get(k)) continue;
      labels[k] = t;
    }
  }
  const out: RoleNavOverride = {
    ...(hidden.length ? { hidden } : {}),
    ...(hiddenGroups.length ? { hiddenGroups } : {}),
    ...(order.length ? { order } : {}),
    ...(Object.keys(labels).length ? { labels } : {}),
  };
  return Object.keys(out).length ? out : null;
}

function parseAdmin(raw: unknown): AdminNavOverrides | null {
  if (!isObj(raw)) return null;
  const ids = ADMIN_NAV.map((s) => s.id);
  const required = new Set(ADMIN_NAV.filter((s) => s.required).map((s) => s.id));
  const hiddenGroups = uniq(strs(raw.hiddenGroups)).filter((id) => ids.includes(id) && !required.has(id));
  const orderIn = uniq(strs(raw.groupOrder)).filter((id) => ids.includes(id));
  const groupOrder = orderIn.length > 0 && orderIn.join("|") !== ids.filter((id) => orderIn.includes(id)).join("|") ? orderIn : [];
  const out: AdminNavOverrides = { ...(hiddenGroups.length ? { hiddenGroups } : {}), ...(groupOrder.length ? { groupOrder } : {}) };
  return Object.keys(out).length ? out : null;
}

/** Ham değer (JSON metni ya da nesne) → geçerli, seyrek fark. Bozuk = boş (varsayılan menüler). */
export function parseMenuOverrides(raw: unknown): MenuOverrides {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return EMPTY_MENU_OVERRIDES;
    try {
      v = JSON.parse(raw);
    } catch {
      return EMPTY_MENU_OVERRIDES;
    }
  }
  if (!isObj(v)) return EMPTY_MENU_OVERRIDES;
  const roles: Partial<Record<NavLayoutKey, RoleNavOverride>> = {};
  if (isObj(v.roles)) {
    for (const key of NAV_LAYOUT_KEYS) {
      const r = parseRole(v.roles[key], NAV_LAYOUT_BY_KEY[key]);
      if (r) roles[key] = r;
    }
  }
  const admin = parseAdmin(v.admin);
  return { ...(Object.keys(roles).length ? { roles } : {}), ...(admin ? { admin } : {}) };
}

export function isEmptyMenuOverrides(o: MenuOverrides): boolean {
  return !o.roles && !o.admin;
}

/** Kaydedilecek metin: boşsa null (varsayılana dön). */
export function serializeMenuOverrides(o: MenuOverrides): string | null {
  const clean = parseMenuOverrides(o);
  return isEmptyMenuOverrides(clean) ? null : JSON.stringify(clean);
}
