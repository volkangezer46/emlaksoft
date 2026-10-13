import type { LdNode } from "@/lib/seo/jsonld";

/**
 * İlan detayı BreadcrumbList (SAF): Vitrin › İlçe › İlan. İlçe yoksa il; ikisi de yoksa iki öğe (Vitrin › İlan).
 * İlçe sayfası olmadığı için ara öğe vitrinin bölge aramasına bağlanır (`?q=<ilçe>`; URL yapısı değişmez).
 */
export type VitrinBreadcrumbInput = {
  base: string;
  slug: string;
  officeName?: string | null;
  district?: string | null;
  province?: string | null;
  listingId: string;
  listingName: string;
};

export function vitrinListingBreadcrumbLd(input: VitrinBreadcrumbInput): LdNode {
  const vitrinUrl = `${input.base}/vitrin/${input.slug}`;
  const area = (input.district ?? "").trim() || (input.province ?? "").trim();
  const office = (input.officeName ?? "").trim();
  const items: { name: string; item: string }[] = [{ name: office ? `${office} vitrini` : "Vitrin", item: vitrinUrl }];
  if (area) items.push({ name: area, item: `${vitrinUrl}?q=${encodeURIComponent(area)}` });
  items.push({ name: input.listingName, item: `${vitrinUrl}/${input.listingId}` });
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.item })),
  };
}
