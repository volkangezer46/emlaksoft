import { renderMenuIcon } from "@/lib/site-menu/icon-node";
import { PREVIEW_LABELS, previewForHref, sectionIconName } from "@/lib/site-menu/previews";
import type { PublicSiteMenu } from "@/lib/site-menu/public";
import type { FeaturedPreviewKind } from "@/lib/site-menu/schema";
import { FeaturedPreview } from "./featured-preview";
import type { ClientGroup, ClientPreview } from "./mega-menu";

/**
 * Herkese açık menü verisini istemci bileşeninin beklediği biçime çevirir (TEK yer: site üst barı ve admin canlı
 * önizlemesi aynı işlevi kullanır). İkonlar ve önizleme SAHNELERİ burada çizilir; sunucu bileşeninden çağrıldığında
 * istemci paketine ne ikon listesi ne SVG sahne kodu girer (yalnız hazır öğe gider).
 *
 * Canlı önizleme: her bağlantının hedefinden önizleme türü türetilir (`previewForHref`); öne çıkan kartın admin'de seçilen
 * önizlemesi VARSAYILAN katmandır (seçilmemişse ilk eşleşen bağlantınınki). Medya yüklenmişse medya önceliklidir ve
 * canlı katman çizilmez. Yalnız bu panelde kullanılan türler çizilir.
 */
export function toClientGroups(menu: PublicSiteMenu, assetBase?: (id: string) => string): ClientGroup[] {
  return menu.groups.map((g) => {
    const columns = g.columns.map((c) => {
      const iconName = sectionIconName(c.title);
      const first = c.items[0];
      return {
        title: c.title,
        iconNode: c.title ? (iconName ? renderMenuIcon({ kind: "lucide", name: iconName }, 15) : first ? renderMenuIcon(first.icon, 15, assetBase) : null) : null,
        items: c.items.map(({ icon, ...it }) => ({ ...it, iconNode: renderMenuIcon(icon, 18, assetBase), pv: previewForHref(it.href) })),
      };
    });

    const f = g.featured;
    let previews: ClientPreview[] | undefined;
    if (f && !f.media) {
      const labels = new Map<FeaturedPreviewKind, string>();
      for (const c of columns) for (const it of c.items) if (it.pv && !labels.has(it.pv)) labels.set(it.pv, it.label);
      const def = f.preview ?? [...labels.keys()][0] ?? null;
      if (def) {
        const kinds = [def, ...[...labels.keys()].filter((k) => k !== def)];
        previews = kinds.map((kind) => ({
          kind,
          node: <FeaturedPreview kind={kind} label={kind === def && f.preview ? PREVIEW_LABELS[kind] : (labels.get(kind) ?? PREVIEW_LABELS[kind])} />,
        }));
      }
    }

    return {
      ...g,
      columns,
      featured: f ? { ...f, iconNode: renderMenuIcon(f.icon, 22, assetBase) } : null,
      previews,
    };
  });
}
