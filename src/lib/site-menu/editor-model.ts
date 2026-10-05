import { LIMITS, type FooterColumn, type FooterLink, type MenuGroup, type MenuItem, type SiteMenuConfig } from "./schema";

/**
 * Admin editörünün saf durum yardımcıları (taşıma, ekleme, kimlik üretimi). Test edilebilir; React'a bağlı değil.
 * Her işlev girdiyi DEĞİŞTİRMEZ, yeni yapılandırma döner.
 */

export function newId(prefix: string, taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (let i = 0; i < 20; i++) {
    const id = `${prefix}-${Math.floor(random() * 0xffffff).toString(16).padStart(6, "0")}`;
    if (!taken.has(id)) return id;
  }
  return `${prefix}-${taken.size}-${Math.floor(random() * 1e9)}`;
}

export function allIds(cfg: SiteMenuConfig): Set<string> {
  const ids = new Set<string>();
  for (const g of cfg.groups) {
    ids.add(g.id);
    for (const it of g.items) ids.add(it.id);
  }
  for (const c of cfg.footer) {
    ids.add(c.id);
    for (const l of c.links) ids.add(l.id);
  }
  return ids;
}

export function moveInArray<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function blankItem(id: string): MenuItem {
  return { id, section: "", label: "Yeni bağlantı", text: "", href: "/", icon: { kind: "lucide", name: "Sparkles" }, badge: null, hidden: false };
}

export function blankGroup(id: string): MenuGroup {
  return { id, kind: "menu", label: "Yeni grup", href: "", hidden: false, items: [], featured: null };
}

export function blankFeatured(): NonNullable<MenuGroup["featured"]> {
  return { eyebrow: "", icon: { kind: "none" }, title: "Öne çıkan", text: "", ctaLabel: "Göz at", href: "/", hidden: false, media: null };
}

export function blankFooterColumn(id: string): FooterColumn {
  return { id, title: "Yeni sütun", hidden: false, autoPlans: false, links: [] };
}

export function blankFooterLink(id: string): FooterLink {
  return { id, label: "Yeni bağlantı", href: "/", hidden: false };
}

export function canAddItem(cfg: SiteMenuConfig, groupIndex: number): boolean {
  const total = cfg.groups.reduce((n, g) => n + g.items.length, 0);
  return cfg.groups[groupIndex].items.length < LIMITS.maxItemsPerGroup && total < LIMITS.maxTotalItems;
}

/** Bir bağlantıyı başka bir bağlantının yerine ya da başka bir grubun sonuna taşır (sürükle-bırak). */
export function moveItem(
  cfg: SiteMenuConfig,
  itemId: string,
  target: { kind: "item"; id: string } | { kind: "group"; id: string },
): SiteMenuConfig {
  let fromG = -1;
  let fromI = -1;
  cfg.groups.forEach((g, gi) => {
    const i = g.items.findIndex((it) => it.id === itemId);
    if (i !== -1) {
      fromG = gi;
      fromI = i;
    }
  });
  if (fromG === -1) return cfg;

  let toG = -1;
  let toI = -1;
  if (target.kind === "group") {
    toG = cfg.groups.findIndex((g) => g.id === target.id);
    if (toG === -1 || cfg.groups[toG].kind === "link") return cfg;
    toI = cfg.groups[toG].items.length;
    if (toG === fromG) toI -= 1;
  } else {
    cfg.groups.forEach((g, gi) => {
      const i = g.items.findIndex((it) => it.id === target.id);
      if (i !== -1) {
        toG = gi;
        toI = i;
      }
    });
    if (toG === -1) return cfg;
  }
  if (toG !== fromG && cfg.groups[toG].items.length >= LIMITS.maxItemsPerGroup) return cfg;

  const next = structuredClone(cfg);
  const [item] = next.groups[fromG].items.splice(fromI, 1);
  next.groups[toG].items.splice(toI, 0, item);
  return next;
}

export function moveGroup(cfg: SiteMenuConfig, index: number, delta: -1 | 1): SiteMenuConfig {
  const to = index + delta;
  if (to < 0 || to >= cfg.groups.length) return cfg;
  return { ...cfg, groups: moveInArray(cfg.groups, index, to) };
}

/** Yapılandırmalar aynı mı (kaydedilmemiş değişiklik göstergesi). */
export function sameConfig(a: SiteMenuConfig | null, b: SiteMenuConfig | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
