import { defaultSiteMenu } from "@/lib/site-menu/defaults";

/**
 * ÜST MENÜ (mega menü) VARSAYILAN İÇERİĞİNİN SALT OKUNUR GÖRÜNÜMÜ.
 * Menünün tek kaynağı artık admin'in yayınladığı yapılandırmadır (`/admin/site-menu`, `src/lib/site-menu/`); hiç yayın
 * yokken `src/lib/site-menu/defaults.ts` içeriği gösterilir. Bu dosya o varsayılanı eski "sütunlu grup" biçiminde sunar ve
 * `marketing-nav.test.ts` sözleşmesinin (her bağlantı var olan sayfaya/bölüm kimliğine gider; menüde fiyat/paket adı yok)
 * dayanağıdır. Menü içeriğini değiştirmek için `defaults.ts` (varsayılan) veya admin ekranı kullanılır, burası değil.
 */
export type NavLink = { label: string; text: string; href: string; icon: string };
export type NavColumn = { title: string; items: NavLink[] };
export type NavFeatured = { eyebrow: string; title: string; text: string; href: string; cta: string; icon: string };
export type NavGroup = { id: string; label: string; columns: NavColumn[]; featured: NavFeatured };

function derive(): NavGroup[] {
  const out: NavGroup[] = [];
  for (const g of defaultSiteMenu().groups) {
    if (g.kind !== "menu" || !g.featured) continue;
    const cols = new Map<string, NavLink[]>();
    for (const it of g.items) {
      const list = cols.get(it.section) ?? [];
      list.push({ label: it.label, text: it.text, href: it.href, icon: it.icon.kind === "lucide" ? it.icon.name : "" });
      cols.set(it.section, list);
    }
    out.push({
      id: g.id,
      label: g.label,
      columns: [...cols.entries()].map(([title, items]) => ({ title, items })),
      featured: {
        eyebrow: g.featured.eyebrow,
        title: g.featured.title,
        text: g.featured.text,
        href: g.featured.href,
        cta: g.featured.ctaLabel,
        icon: g.featured.icon.kind === "lucide" ? g.featured.icon.name : "",
      },
    });
  }
  return out;
}

export const MARKETING_NAV: readonly NavGroup[] = derive();

/** Düz bağlantı listesi (klavye sırası, test ve mobil için). */
export function allNavLinks(): NavLink[] {
  return MARKETING_NAV.flatMap((g) => g.columns.flatMap((c) => c.items));
}
