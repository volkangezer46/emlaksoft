import { defaultLabelMap } from "@/lib/definition-defaults";

/** Geriye dönük uyum: tek kaynak `definition-defaults.ts`. */
export { LEAD_SOURCES, type LeadSource } from "@/lib/definition-defaults";

/**
 * Ham kaynak değerini ("portal_sahibinden") okunur Türkçe etikete çevirir: önce tanım etiketi,
 * yoksa alt çizgileri boşluğa çevirip ilk harfi büyütür. Boşsa null.
 */
export function formatLeadSource(raw: string | null | undefined, custom?: ReadonlyMap<string, string>): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const known = custom?.get(v) ?? defaultLabelMap("customer_source")[v];
  if (known) return known;
  const spaced = v.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toLocaleUpperCase("tr-TR") + spaced.slice(1);
}
