import type { LdNode } from "@/lib/seo/jsonld";

/**
 * İlan detayı BreadcrumbList (SAF): Vitrin › İlçe › İlan. İlçe yoksa il; ikisi de yoksa iki öğe (Vitrin › İlan).
 * İlçe sayfası olmadığı için ara öğe vitrinin kanonik adresine bağlanır: `?q=<ilçe>` araması yalnız başlık/kod/adres
 * satırında arar (boş dönebilir) ve kanonik değildir; yapısal veri arama motoruna yalnız kanonik URL gösterir.
 */
export type VitrinBreadcrumbInput = {
  base: string;
  slug: string;
  officeName?: string | null;
  district?: string | null;
  province?: string | null;
  /** Kanonik mutlak ilan adresi (`vitrinListingUrl`, src/lib/vitrin/listing-slug.ts). */
  listingUrl: string;
  listingName: string;
};

export function vitrinListingBreadcrumbLd(input: VitrinBreadcrumbInput): LdNode {
  const vitrinUrl = `${input.base}/vitrin/${input.slug}`;
  const area = (input.district ?? "").trim() || (input.province ?? "").trim();
  const office = (input.officeName ?? "").trim();
  const items: { name: string; item: string }[] = [{ name: office ? `${office} vitrini` : "Vitrin", item: vitrinUrl }];
  if (area) items.push({ name: area, item: vitrinUrl });
  items.push({ name: input.listingName, item: input.listingUrl });
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.item })),
  };
}
